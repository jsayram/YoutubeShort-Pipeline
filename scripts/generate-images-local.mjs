import fs from "node:fs/promises";
import path from "node:path";
import {
  commandOutput,
  dedupeTerms,
  loadEnv,
  parseArgs,
  readJson,
  run,
  sleep,
  splitNegations,
  stripQuotedText,
  TEXT_NEGATIVES,
  videoDir,
  writeJson,
} from "./lib.mjs";

// Local image generation through a running ComfyUI. Same shape as the Voicebox step: the app is
// a local HTTP service, this script only speaks its documented API and never edits its tree.

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const prompts = await readJson(path.join(projectDir, "content", "image-prompts.json"));
const gen = config.imageGen ?? {};

const baseUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const checkpoint = flags.checkpoint ?? gen.checkpoint ?? "RealVisXL_V5.0_fp16.safetensors";
const vaeName = flags.vae ?? gen.vae ?? "sdxl_vae_fp16_fix.safetensors";
const steps = Number(flags.steps ?? gen.steps ?? 30);
const cfg = Number(flags.cfg ?? gen.cfg ?? 5.5);
const sampler = flags.sampler ?? gen.sampler ?? "dpmpp_2m";
const scheduler = flags.scheduler ?? gen.scheduler ?? "karras";

// SDXL is trained on ~1 megapixel buckets. 768x1344 is its native 9:16-ish bucket; going
// straight to 1080x1920 produces duplicated limbs and warped geometry. Generate in-bucket,
// then scale to the real frame size.
const genWidth = Number(gen.genWidth ?? 768);
const genHeight = Number(gen.genHeight ?? 1344);
const outWidth = Number(config.width ?? 1080);
const outHeight = Number(config.height ?? 1920);

// The style suffix historically carried its own "no readable text, no logo, no watermark" tail.
// Those phrases were being fed to the positive encoder, where they read as a request for text.
// Split once here; every prompt reuses the cleaned half and inherits the negated half.
const { positive: styleSuffix, negatives: styleNegatives } = splitNegations(gen.styleSuffix ?? "");
// Screens and covers are where SDXL invents logos and garbled lettering, which the style
// guide rejects outright — so the glowing-display vocabulary is banned here, not just "text".
const negativePrompt =
  gen.negativePrompt ??
  "text, letters, words, typography, numbers, watermark, signature, logo, emblem, icon, badge, " +
    "sticker, label, ui, interface, app screen, glowing display, screen content, chart, graph, " +
    "caption, subtitle, blurry, low quality, jpeg artifacts, deformed, extra limbs, cluttered, " +
    "busy background, stock photo, collage, frame, border, oversaturated, neon plastic, " +
    // The style guide wants a charcoal world lit by one accent. Left unconstrained, SDXL
    // drifts to bright studio backdrops and paints the accent onto the subject as a material.
    "white background, bright background, high-key lighting, daylight, overcast sky, blown " +
    "highlights, washed out, pale grey backdrop, painted green object, coloured plastic object, " +
    // "acid-lime" reads as the fruit often enough to matter, and covered objects like books
    // attract embossed titles no amount of "no text" prevents.
    "lime fruit, citrus, fruit, pencil, stationery, embossed lettering, engraved title, " +
    "orange glow, amber light, warm sunset, moon";

const outputDir = path.join(projectDir, "public", "generated");
await fs.mkdir(outputDir, { recursive: true });

if (!Array.isArray(prompts) || prompts.length === 0) {
  throw new Error("content/image-prompts.json must contain at least one prompt.");
}

const stats = await fetch(`${baseUrl}/system_stats`).catch(() => null);
if (!stats?.ok) {
  throw new Error(
    `ComfyUI is not reachable at ${baseUrl}. Start it with:\n` +
      `  cd ~/ComfyUI && venv/bin/python main.py --listen 127.0.0.1 --port 8188`,
  );
}

const objectInfo = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`).then((r) => r.json());
const available = objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0];
if (!available.includes(checkpoint)) {
  throw new Error(
    `ComfyUI does not see checkpoint "${checkpoint}". Available: ${available.join(", ") || "none"}.`,
  );
}

// A stable seed per prompt id keeps re-runs reproducible, which the render pipeline relies on.
function seedFor(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 2 ** 31;
}

// Positive conditioning gets only what should appear. Everything the prompt asked *not* to see
// is routed to the negative encoder, together with the standing no-lettering vocabulary — the
// frames are meant to be wordless so captions can be added over them afterwards.
export function conditioningFor(item) {
  const source = splitNegations(stripQuotedText(item.prompt));
  return {
    positive: [source.positive, styleSuffix].filter(Boolean).join(" ").trim(),
    negative: dedupeTerms([
      negativePrompt,
      ...TEXT_NEGATIVES,
      ...styleNegatives,
      ...source.negatives,
    ]).join(", "),
  };
}

function workflowFor(item) {
  const { positive, negative } = conditioningFor(item);
  return {
    ckpt: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    vae: { class_type: "VAELoader", inputs: { vae_name: vaeName } },
    pos: { class_type: "CLIPTextEncode", inputs: { text: positive, clip: ["ckpt", 1] } },
    neg: { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["ckpt", 1] } },
    latent: {
      class_type: "EmptyLatentImage",
      inputs: { width: genWidth, height: genHeight, batch_size: 1 },
    },
    sample: {
      class_type: "KSampler",
      inputs: {
        seed: Number(item.seed ?? seedFor(item.id)),
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ["ckpt", 0],
        positive: ["pos", 0],
        negative: ["neg", 0],
        latent_image: ["latent", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    save: {
      class_type: "SaveImage",
      inputs: { filename_prefix: `ytshort/${flags.project}/${item.id}`, images: ["decode", 0] },
    },
  };
}

async function generate(item) {
  const queued = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflowFor(item), client_id: "youtube-short-pipeline" }),
  });
  if (!queued.ok) throw new Error(`ComfyUI rejected the workflow: ${await queued.text()}`);
  const { prompt_id: promptId, node_errors: nodeErrors } = await queued.json();
  if (nodeErrors && Object.keys(nodeErrors).length) {
    throw new Error(`ComfyUI node errors: ${JSON.stringify(nodeErrors)}`);
  }

  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const history = await fetch(`${baseUrl}/history/${promptId}`).then((r) => r.json());
    const entry = history[promptId];
    if (entry) {
      const status = entry.status ?? {};
      if (status.status_str === "error") {
        const message = (status.messages ?? [])
          .filter(([kind]) => kind === "execution_error")
          .map(([, detail]) => detail.exception_message)
          .join("; ");
        throw new Error(message || `ComfyUI failed to render ${item.id}.`);
      }
      if (status.completed) {
        for (const output of Object.values(entry.outputs ?? {})) {
          const image = (output.images ?? [])[0];
          if (image) return image;
        }
        throw new Error(`ComfyUI completed ${item.id} but returned no image.`);
      }
    }
    await sleep(1500);
  }
  throw new Error(`ComfyUI timed out on ${item.id}.`);
}

const manifest = [];
const startedAt = Date.now();

for (const [index, item] of prompts.entries()) {
  if (!item.id || !item.prompt) throw new Error("Every image prompt needs an id and prompt.");
  const finalPath = path.join(outputDir, `${item.id}.png`);

  if (!flags.force) {
    const existing = await fs.access(finalPath).then(
      () => true,
      () => false,
    );
    if (existing) {
      console.log(`[${index + 1}/${prompts.length}] ${item.id} — already generated, skipping`);
      manifest.push({ id: item.id, file: `public/generated/${item.id}.png`, skipped: true });
      continue;
    }
  }

  const itemStart = Date.now();
  const image = await generate(item);
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  const response = await fetch(`${baseUrl}/view?${query}`);
  if (!response.ok) throw new Error(`Could not download ${item.id}: ${await response.text()}`);

  const rawPath = path.join(outputDir, `${item.id}.raw.png`);
  await fs.writeFile(rawPath, Buffer.from(await response.arrayBuffer()));

  // Cover-and-crop to the exact frame so the composition never letterboxes.
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    rawPath,
    "-vf",
    `scale=${outWidth}:${outHeight}:force_original_aspect_ratio=increase,crop=${outWidth}:${outHeight}`,
    finalPath,
  ]);
  await fs.rm(rawPath, { force: true });

  const seconds = ((Date.now() - itemStart) / 1000).toFixed(1);
  console.log(`[${index + 1}/${prompts.length}] ${item.id} — ${seconds}s`);
  manifest.push({
    id: item.id,
    file: `public/generated/${item.id}.png`,
    provider: "comfyui",
    checkpoint,
    seed: Number(item.seed ?? seedFor(item.id)),
    steps,
    cfg,
    sampler,
    scheduler,
  });
}

await writeJson(path.join(outputDir, "manifest.json"), manifest);

const made = manifest.filter((entry) => !entry.skipped).length;
console.log(
  `\n${made} image(s) generated locally in ${((Date.now() - startedAt) / 1000).toFixed(0)}s ` +
    `(${manifest.length - made} reused). No network, no API key.`,
);

for (const entry of manifest) {
  const file = path.join(projectDir, entry.file);
  const size = await commandOutput("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    file,
  ]);
  if (size.trim() !== `${outWidth},${outHeight}`) {
    throw new Error(`${entry.file} is ${size.trim()}, expected ${outWidth},${outHeight}.`);
  }
}
console.log(`All images verified at ${outWidth}x${outHeight}.`);
