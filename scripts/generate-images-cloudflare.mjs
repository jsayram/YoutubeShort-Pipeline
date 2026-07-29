import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, parseArgs, readJson, run, videoDir } from "./lib.mjs";
import {
  buildFluxPrompt,
  finishImageRun,
  installGenerationLock,
  promptWithReferences,
  referencesForScene,
  resolveSeedSalt,
  seedFor,
  splitImageItems,
  writeExactImage,
} from "./image-worker-common.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  throw new Error(
    "Cloudflare FLUX needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.",
  );
}

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const promptsFile = process.env.IMAGE_PROMPTS_FILE
  ? path.resolve(process.env.IMAGE_PROMPTS_FILE)
  : path.join(projectDir, "content", "image-prompts.json");
const prompts = await readJson(promptsFile);
const gen = config.imageGen ?? {};
const { references, scenes } = splitImageItems(prompts, gen);
const releaseLock = await installGenerationLock(projectDir, flags.project);

const sceneSeedSalt = resolveSeedSalt(flags, flags.force);
const referenceSeedSalt = resolveSeedSalt(flags, flags["force-references"]);
if (sceneSeedSalt) console.log(`Forced regeneration: scene seed salt ${sceneSeedSalt}.`);
if (referenceSeedSalt) console.log(`Forced regeneration: reference seed salt ${referenceSeedSalt}.`);
const model = "@cf/black-forest-labs/flux-2-klein-4b";
const endpoint =
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
  `/ai/run/${model}`;
const sceneWidth = Number(gen.genWidth ?? 768);
const sceneHeight = Number(gen.genHeight ?? 1344);
const outWidth = Number(gen.outWidth ?? config.width ?? 1080);
const outHeight = Number(gen.outHeight ?? config.height ?? 1920);
const referenceSize = Math.min(480, Number(gen.referenceWidth ?? 480));
const guidance = Number(flags.guidance ?? gen.guidance ?? 1);
const outputDir = path.join(projectDir, "public", "generated");
const referenceDir = path.join(projectDir, "assets", "references");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(referenceDir, { recursive: true });

function cleanPrompt(item) {
  return buildFluxPrompt(item, gen.styleSuffix);
}

async function cloudflareImage({ prompt, width, height, seed, referenceFiles = [] }) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("guidance", String(guidance));
  form.append("seed", String(seed));
  for (const [index, file] of referenceFiles.slice(0, 4).entries()) {
    form.append(`input_image_${index}`, new Blob([file.bytes]), `${file.id}.png`);
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cloudflare FLUX failed (${response.status}): ${detail}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("image/")) return Buffer.from(await response.arrayBuffer());
  const payload = await response.json();
  const encoded =
    payload?.result?.image ??
    payload?.result?.data?.[0]?.b64_json ??
    payload?.image;
  if (!encoded) throw new Error("Cloudflare FLUX returned no image data.");
  return Buffer.from(encoded, "base64");
}

async function cloudReference(reference) {
  const source = path.join(referenceDir, `${reference.id}.png`);
  const temporary = path.join(referenceDir, `.${reference.id}.cloudflare.png`);
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vf",
    `scale=${referenceSize}:${referenceSize}:force_original_aspect_ratio=decrease,pad=${referenceSize}:${referenceSize}:(ow-iw)/2:(oh-ih)/2:color=0x111014`,
    "-frames:v",
    "1",
    temporary,
  ]);
  const bytes = await fs.readFile(temporary);
  await fs.rm(temporary, { force: true });
  return { ...reference, bytes };
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
    const bytes = await cloudflareImage({
      prompt: cleanPrompt(reference),
      width: referenceSize,
      height: referenceSize,
      seed: Number(reference.seed ?? seedFor(reference.id, referenceSeedSalt)),
    });
    await writeExactImage({
      bytes,
      finalPath,
      outWidth: referenceSize,
      outHeight: referenceSize,
    });
    console.log(`[ref ${index + 1}/${references.length}] ${reference.id} — generated`);
  }

  const sharedReferences = [];
  for (const reference of references) {
    sharedReferences.push(await cloudReference(reference));
  }

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
    const seed = Number(item.seed ?? seedFor(item.id, sceneSeedSalt));
    const bytes = await cloudflareImage({
      prompt: promptWithReferences(cleanPrompt(item), selectedReferences),
      width: sceneWidth,
      height: sceneHeight,
      seed,
      referenceFiles: selectedReferences,
    });
    await writeExactImage({ bytes, finalPath, outWidth, outHeight, postProcess: gen.postProcess ?? null });
    console.log(
      `[${index + 1}/${scenes.length}] ${item.id} — ${((Date.now() - itemStart) / 1000).toFixed(1)}s`,
    );
    manifest.push({
      id: item.id,
      file: `public/generated/${item.id}.png`,
      provider: "cloudflare-flux2",
      model,
      seed,
      steps: 4,
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
    `Cloudflare FLUX.2 finished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s with ${references.length} reusable reference image(s).`,
  );
} finally {
  releaseLock();
}
