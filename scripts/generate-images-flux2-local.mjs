import fs from "node:fs/promises";
import path from "node:path";
import {
  loadEnv,
  parseArgs,
  readJson,
  scrubTextNouns,
  splitNegations,
  stripQuotedText,
  sleep,
  videoDir,
} from "./lib.mjs";
import {
  finishImageRun,
  installGenerationLock,
  promptWithReferences,
  referencesForScene,
  seedFor,
  splitImageItems,
  writeExactImage,
} from "./image-worker-common.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const prompts = await readJson(path.join(projectDir, "content", "image-prompts.json"));
const gen = config.imageGen ?? {};
const { references, scenes } = splitImageItems(prompts, gen);
const releaseLock = await installGenerationLock(projectDir, flags.project);

const baseUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const diffusionModel =
  flags.model ?? gen.diffusionModel ?? "flux-2-klein-4b.safetensors";
const textEncoder = flags.encoder ?? gen.textEncoder ?? "qwen_3_4b.safetensors";
const vaeName = flags.vae ?? gen.vae ?? "flux2-vae.safetensors";
const steps = Number(flags.steps ?? gen.steps ?? 4);
const guidance = Number(flags.guidance ?? gen.guidance ?? 1);
const sampler = flags.sampler ?? gen.sampler ?? "euler";
const sceneWidth = Number(gen.genWidth ?? 768);
const sceneHeight = Number(gen.genHeight ?? 1344);
const outWidth = Number(gen.outWidth ?? config.width ?? 1080);
const outHeight = Number(gen.outHeight ?? config.height ?? 1920);
const referenceWidth = Number(gen.referenceWidth ?? 768);
const referenceHeight = Number(gen.referenceHeight ?? 768);
const outputDir = path.join(projectDir, "public", "generated");
const referenceDir = path.join(projectDir, "assets", "references");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(referenceDir, { recursive: true });

function cleanPrompt(item) {
  const source = splitNegations(stripQuotedText(item.prompt));
  const style = splitNegations(gen.styleSuffix ?? "");
  return scrubTextNouns([source.positive, style.positive].filter(Boolean).join(". "));
}

async function modelChoices(nodeClass, field) {
  const response = await fetch(`${baseUrl}/object_info/${nodeClass}`).catch(() => null);
  if (!response?.ok) return null;
  const info = await response.json();
  return info?.[nodeClass]?.input?.required?.[field]?.[0] ?? [];
}

const [availableModels, availableEncoders, availableVaes] = await Promise.all([
  modelChoices("UNETLoader", "unet_name"),
  modelChoices("CLIPLoader", "clip_name"),
  modelChoices("VAELoader", "vae_name"),
]);
if (!availableModels) throw new Error(`ComfyUI is not reachable at ${baseUrl}.`);
for (const [label, wanted, available] of [
  ["diffusion model", diffusionModel, availableModels],
  ["text encoder", textEncoder, availableEncoders],
  ["VAE", vaeName, availableVaes],
]) {
  if (!available.includes(wanted)) {
    throw new Error(`ComfyUI is missing FLUX ${label} "${wanted}".`);
  }
}

const uploaded = new Map();
async function uploadReference(reference) {
  if (uploaded.has(reference.id)) return uploaded.get(reference.id);
  const absolute = path.join(referenceDir, `${reference.id}.png`);
  const bytes = await fs.readFile(absolute);
  const form = new FormData();
  form.append("image", new Blob([bytes]), `${reference.id}.png`);
  form.append("overwrite", "true");
  const response = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`ComfyUI rejected reference ${reference.id}: ${await response.text()}`);
  }
  const value = await response.json();
  const handle = value.subfolder ? `${value.subfolder}/${value.name}` : value.name;
  const uploadedReference = { ...reference, handle };
  uploaded.set(reference.id, uploadedReference);
  return uploadedReference;
}

function workflowFor({ id, prompt, seed, width, height, referenceHandles }) {
  const nodes = {
    model: {
      class_type: "UNETLoader",
      inputs: { unet_name: diffusionModel, weight_dtype: "default" },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: textEncoder, type: "flux2", device: "default" },
    },
    vae: { class_type: "VAELoader", inputs: { vae_name: vaeName } },
    text: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["clip", 0] } },
    negative: {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["text", 0] },
    },
    latent: {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } },
    sigmas: { class_type: "Flux2Scheduler", inputs: { steps, width, height } },
  };

  let positive = ["text", 0];
  let negative = ["negative", 0];
  for (const [index, reference] of referenceHandles.entries()) {
    const imageId = `ref_image_${index}`;
    const encodeId = `ref_encode_${index}`;
    const positiveId = `ref_positive_${index}`;
    const negativeId = `ref_negative_${index}`;
    nodes[imageId] = { class_type: "LoadImage", inputs: { image: reference.handle } };
    nodes[encodeId] = {
      class_type: "VAEEncode",
      inputs: { pixels: [imageId, 0], vae: ["vae", 0] },
    };
    nodes[positiveId] = {
      class_type: "ReferenceLatent",
      inputs: { conditioning: positive, latent: [encodeId, 0] },
    };
    nodes[negativeId] = {
      class_type: "ReferenceLatent",
      inputs: { conditioning: negative, latent: [encodeId, 0] },
    };
    positive = [positiveId, 0];
    negative = [negativeId, 0];
  }

  nodes.guider = {
    class_type: "CFGGuider",
    inputs: { model: ["model", 0], positive, negative, cfg: guidance },
  };
  nodes.sample = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["noise", 0],
      guider: ["guider", 0],
      sampler: ["sampler", 0],
      sigmas: ["sigmas", 0],
      latent_image: ["latent", 0],
    },
  };
  nodes.decode = {
    class_type: "VAEDecode",
    inputs: { samples: ["sample", 0], vae: ["vae", 0] },
  };
  nodes.save = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: `ytshort/${flags.project}/${id}`,
      images: ["decode", 0],
    },
  };
  return nodes;
}

async function generate(specification) {
  const response = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflowFor(specification),
      client_id: "youtube-short-pipeline-flux2",
    }),
  });
  if (!response.ok) throw new Error(`ComfyUI rejected FLUX.2: ${await response.text()}`);
  const queued = await response.json();
  if (queued.node_errors && Object.keys(queued.node_errors).length) {
    throw new Error(`ComfyUI node errors: ${JSON.stringify(queued.node_errors)}`);
  }

  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const history = await fetch(`${baseUrl}/history/${queued.prompt_id}`).then((item) =>
      item.json(),
    );
    const entry = history[queued.prompt_id];
    if (entry?.status?.status_str === "error") {
      const message = (entry.status.messages ?? [])
        .filter(([kind]) => kind === "execution_error")
        .map(([, detail]) => detail.exception_message)
        .join("; ");
      throw new Error(message || `ComfyUI failed to render ${specification.id}.`);
    }
    if (entry?.status?.completed) {
      for (const output of Object.values(entry.outputs ?? {})) {
        const image = output.images?.[0];
        if (!image) continue;
        const query = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder ?? "",
          type: image.type ?? "output",
        });
        const file = await fetch(`${baseUrl}/view?${query}`);
        if (!file.ok) throw new Error(`Could not download ${specification.id}.`);
        return Buffer.from(await file.arrayBuffer());
      }
      throw new Error(`ComfyUI completed ${specification.id} without an image.`);
    }
    await sleep(1500);
  }
  throw new Error(`ComfyUI timed out on ${specification.id}.`);
}

const startedAt = Date.now();
try {
  for (const [index, reference] of references.entries()) {
    const finalPath = path.join(referenceDir, `${reference.id}.png`);
    const exists = await fs.access(finalPath).then(() => true, () => false);
    if (exists && !flags["force-references"]) {
      console.log(`[ref ${index + 1}/${references.length}] ${reference.id} — reused`);
      continue;
    }
    const bytes = await generate({
      id: reference.id,
      prompt: cleanPrompt(reference),
      seed: Number(reference.seed ?? seedFor(reference.id)),
      width: referenceWidth,
      height: referenceHeight,
      referenceHandles: [],
    });
    await writeExactImage({
      bytes,
      finalPath,
      outWidth: referenceWidth,
      outHeight: referenceHeight,
    });
    console.log(`[ref ${index + 1}/${references.length}] ${reference.id} — generated`);
  }

  const sharedReferences = [];
  for (const reference of references) sharedReferences.push(await uploadReference(reference));

  const manifest = [];
  for (const [index, item] of scenes.entries()) {
    if (!item.id || !item.prompt) throw new Error("Every scene prompt needs an id and prompt.");
    const finalPath = path.join(outputDir, `${item.id}.png`);
    const existing = await fs.access(finalPath).then(() => true, () => false);
    if (existing && !flags.force) {
      console.log(`[${index + 1}/${scenes.length}] ${item.id} — already generated, skipping`);
      manifest.push({
        id: item.id,
        file: `public/generated/${item.id}.png`,
        skipped: true,
      });
      continue;
    }
    const itemStart = Date.now();
    const selectedReferences = referencesForScene(item, sharedReferences);
    const prompt = promptWithReferences(cleanPrompt(item), selectedReferences);
    const seed = Number(item.seed ?? seedFor(item.id));
    const bytes = await generate({
      id: item.id,
      prompt,
      seed,
      width: sceneWidth,
      height: sceneHeight,
      referenceHandles: selectedReferences,
    });
    await writeExactImage({
      bytes,
      finalPath,
      outWidth,
      outHeight,
    });
    console.log(
      `[${index + 1}/${scenes.length}] ${item.id} — ${((Date.now() - itemStart) / 1000).toFixed(1)}s`,
    );
    manifest.push({
      id: item.id,
      file: `public/generated/${item.id}.png`,
      provider: "flux2-local",
      diffusionModel,
      textEncoder,
      seed,
      steps,
      guidance,
      references: selectedReferences.map((reference) => reference.id),
    });
  }

  await finishImageRun({
    projectDir,
    scenes,
    manifest,
    outWidth,
    outHeight,
  });
  console.log(
    `FLUX.2 local finished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s with ${references.length} reusable reference image(s).`,
  );
} finally {
  releaseLock();
}
