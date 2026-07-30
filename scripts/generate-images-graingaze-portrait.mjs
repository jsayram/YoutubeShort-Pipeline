import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, parseArgs, readJson, sleep, videoDir } from "./lib.mjs";
import {
  buildFluxPrompt,
  finishImageRun,
  installGenerationLock,
  resolveSeedSalt,
  seedFor,
  splitImageItems,
  writeExactImage,
} from "./image-worker-common.mjs";
import {
  createImageGenerationAudit,
  selectRequestedScenes,
} from "./image-generation-audit.mjs";

// Krea 2 Turbo, same graph as krea2-local, plus a LoraLoader chain for the Krea2_GrainGaze-portrait
// LoRA (cinematic analog portrait look). Its own provider/script so krea2-local and
// nostalgic-vhs-2000 stay untouched — this is an additive sibling, not a replacement.

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const promptsFile = process.env.IMAGE_PROMPTS_FILE
  ? path.resolve(process.env.IMAGE_PROMPTS_FILE)
  : path.join(projectDir, "content", "image-prompts.json");
const prompts = await readJson(promptsFile);
const gen = config.imageGen ?? {};
const { references, scenes: allScenes } = splitImageItems(prompts, gen);
if (references.length) {
  throw new Error(
    "graingaze-portrait has no reference-image node in its ComfyUI graph, so it cannot honor " +
      `${references.length} configured reference prompt(s). Drop referencePrompts/reference ` +
      "scenes from this style, or switch to flux2-local for character/style consistency.",
  );
}
const selection = selectRequestedScenes(allScenes, flags);
const scenes = selection.scenes;
const releaseLock = await installGenerationLock(projectDir, flags.project);

const sceneSeedSalt = resolveSeedSalt(flags, flags.force);
if (sceneSeedSalt) console.log(`Forced regeneration: scene seed salt ${sceneSeedSalt}.`);

const baseUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const diffusionModel =
  flags.model ?? gen.diffusionModel ?? "krea2_turbo_bf16.safetensors";
const textEncoder = flags.encoder ?? gen.textEncoder ?? "qwen3vl_4b_fp8_scaled.safetensors";
const vaeName = flags.vae ?? gen.vae ?? "qwen_image_vae.safetensors";
const steps = Number(flags.steps ?? gen.steps ?? 8);
const cfg = Number(flags.guidance ?? gen.guidance ?? 1);
const sampler = flags.sampler ?? gen.sampler ?? "euler";
const scheduler = flags.scheduler ?? gen.scheduler ?? "beta";
const sceneWidth = Number(gen.genWidth ?? 1344);
const sceneHeight = Number(gen.genHeight ?? 768);
const outWidth = Number(gen.outWidth ?? config.width ?? 1920);
const outHeight = Number(gen.outHeight ?? config.height ?? 1080);
const outputDir = path.join(projectDir, "public", "generated");
await fs.mkdir(outputDir, { recursive: true });

// Style LoRAs chain off the UNET/CLIP loaders, same pattern as generate-images-local.mjs's
// loraChain, just starting from Krea 2's split model/clip loaders instead of one checkpoint.
const loras = Array.isArray(gen.loras) ? gen.loras.filter((entry) => entry?.name) : [];

function cleanPrompt(item) {
  return buildFluxPrompt(item, gen.compactStyleSuffix ?? gen.styleSuffix);
}

async function modelChoices(nodeClass, field) {
  const response = await fetch(`${baseUrl}/object_info/${nodeClass}`).catch(() => null);
  if (!response?.ok) return null;
  const info = await response.json();
  return info?.[nodeClass]?.input?.required?.[field]?.[0] ?? [];
}

const [availableModels, availableEncoders, availableVaes, availableLoras] = await Promise.all([
  modelChoices("UNETLoader", "unet_name"),
  modelChoices("CLIPLoader", "clip_name"),
  modelChoices("VAELoader", "vae_name"),
  modelChoices("LoraLoader", "lora_name"),
]);
if (!availableModels) throw new Error(`ComfyUI is not reachable at ${baseUrl}.`);
for (const [label, wanted, available] of [
  ["diffusion model", diffusionModel, availableModels],
  ["text encoder", textEncoder, availableEncoders],
  ["VAE", vaeName, availableVaes],
]) {
  if (!available.includes(wanted)) {
    throw new Error(`ComfyUI is missing Krea 2 ${label} "${wanted}".`);
  }
}
for (const lora of loras) {
  if (!availableLoras?.includes(lora.name)) {
    throw new Error(
      `ComfyUI is missing LoRA "${lora.name}". Drop it in the loras folder ComfyUI is ` +
        "configured to scan (see extra_model_paths.yaml), then restart ComfyUI so it re-scans.",
    );
  }
}

const audit = await createImageGenerationAudit({
  projectDir,
  project: flags.project,
  provider: "graingaze-portrait",
  service: {
    type: "ComfyUI Krea 2 Turbo + LoRA",
    baseUrl,
    reachable: true,
    diffusionModelsSeen: availableModels,
    textEncodersSeen: availableEncoders,
    vaesSeen: availableVaes,
    lorasSeen: availableLoras,
  },
  configuration: {
    diffusionModel,
    textEncoder,
    vae: vaeName,
    loras,
    steps,
    cfg,
    sampler,
    scheduler,
    sceneWidth,
    sceneHeight,
    outWidth,
    outHeight,
    selectedScenes: selection.prefixes,
    promptPolicy: {
      sceneAuthority: "enriched concrete scene",
      textBearingProps: "preserved with a wordless glow, light pulse, or abstract pictorial mark",
      readableText: "wordless hard requirement in positive conditioning",
      negativeConditioning: "zeroed by the Krea 2 Turbo workflow (distilled, cfg 1)",
    },
  },
  promptFile: promptsFile,
  prompts: scenes,
});

function loraChain() {
  const nodes = {};
  let model = ["model", 0];
  let clip = ["clip", 0];
  for (const [index, lora] of loras.entries()) {
    const id = `lora${index}`;
    nodes[id] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.name,
        strength_model: Number(lora.strength ?? 1),
        strength_clip: Number(lora.strengthClip ?? lora.strength ?? 1),
        model,
        clip,
      },
    };
    model = [id, 0];
    clip = [id, 1];
  }
  return { nodes, model, clip };
}

// Matches Comfy-Org's official "Text to Image (Krea-2 Turbo)" template: UNETLoader + CLIPLoader
// (type "krea2") + VAELoader, then a LoraLoader chain, CLIPTextEncode into a zeroed-out negative
// like FLUX.2's distilled path, a plain EmptyLatentImage/KSampler pair (8 steps, cfg 1,
// euler/beta by default), then VAEDecode.
function workflowFor({ id, prompt, seed, width, height }) {
  const chain = loraChain();
  return {
    model: {
      class_type: "UNETLoader",
      inputs: { unet_name: diffusionModel, weight_dtype: "default" },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: textEncoder, type: "krea2", device: "default" },
    },
    vae: { class_type: "VAELoader", inputs: { vae_name: vaeName } },
    ...chain.nodes,
    text: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: chain.clip } },
    negative: {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["text", 0] },
    },
    latent: {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    sample: {
      class_type: "KSampler",
      inputs: {
        model: chain.model,
        positive: ["text", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
      },
    },
    decode: {
      class_type: "VAEDecode",
      inputs: { samples: ["sample", 0], vae: ["vae", 0] },
    },
    save: {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `ytshort/${flags.project}/${id}`,
        images: ["decode", 0],
      },
    },
  };
}

async function generate(specification) {
  const response = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflowFor(specification),
      client_id: "youtube-pipeline-graingaze-portrait",
    }),
  });
  if (!response.ok) throw new Error(`ComfyUI rejected graingaze-portrait: ${await response.text()}`);
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
  const manifest = [];
  for (const [index, item] of scenes.entries()) {
    if (!item.id || !item.prompt) throw new Error("Every scene prompt needs an id and prompt.");
    const finalPath = path.join(outputDir, `${item.id}.png`);
    const existing = await fs.access(finalPath).then(() => true, () => false);
    if (existing && !flags.force) {
      console.log(`[${index + 1}/${scenes.length}] ${item.id} — already generated, skipping`);
      const prompt = cleanPrompt(item);
      manifest.push({
        id: item.id,
        file: `public/generated/${item.id}.png`,
        skipped: true,
        prompt,
        promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
        postProcess: gen.postProcess ?? null,
      });
      await audit.startScene(item.id, {
        finalPrompt: prompt,
        seed: Number(item.seed ?? seedFor(item.id, sceneSeedSalt)),
        settings: { steps, cfg, sampler, scheduler, width: sceneWidth, height: sceneHeight },
        postProcess: gen.postProcess ?? null,
      });
      await audit.completeScene(item.id, { status: "reused", output: manifest.at(-1) });
      continue;
    }
    const itemStart = Date.now();
    const prompt = cleanPrompt(item);
    const seed = Number(item.seed ?? seedFor(item.id, sceneSeedSalt));
    await audit.startScene(item.id, {
      finalPrompt: prompt,
      seed,
      settings: { steps, cfg, sampler, scheduler, width: sceneWidth, height: sceneHeight },
      postProcess: gen.postProcess ?? null,
    });
    let bytes;
    try {
      bytes = await generate({
        id: item.id,
        prompt,
        seed,
        width: sceneWidth,
        height: sceneHeight,
      });
    } catch (error) {
      await audit.failScene(item.id, error);
      await audit.fail(error);
      throw error;
    }
    await writeExactImage({
      bytes,
      finalPath,
      outWidth,
      outHeight,
      postProcess: gen.postProcess ?? null,
    });
    console.log(
      `[${index + 1}/${scenes.length}] ${item.id} — ${((Date.now() - itemStart) / 1000).toFixed(1)}s`,
    );
    manifest.push({
      id: item.id,
      file: `public/generated/${item.id}.png`,
      provider: "graingaze-portrait",
      diffusionModel,
      textEncoder,
      loras,
      seed,
      steps,
      cfg,
      prompt,
      promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
      postProcess: gen.postProcess ?? null,
    });
    await audit.completeScene(item.id, { output: manifest.at(-1) });
  }

  await finishImageRun({
    projectDir,
    scenes,
    allScenes,
    manifest,
    outWidth,
    outHeight,
    partial: selection.partial,
  });
  await audit.finish("completed", {
    manifest: "public/generated/manifest.json",
    generated: manifest.filter((entry) => !entry.skipped).length,
    reused: manifest.filter((entry) => entry.skipped).length,
    usage: {
      requests: 0,
      creditsUsed: 0,
      estimatedCost: 0,
      quotaRemaining: null,
      quotaNote: "Local ComfyUI Krea 2 + LoRA generation does not consume cloud credits.",
    },
  });
  console.log(`GrainGaze portrait finished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s.`);
} catch (error) {
  if (audit.document.status !== "failed") await audit.fail(error);
  throw error;
} finally {
  releaseLock();
}
