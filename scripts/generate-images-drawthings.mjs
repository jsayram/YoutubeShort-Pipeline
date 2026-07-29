import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, parseArgs, readJson, videoDir } from "./lib.mjs";
import {
  finishImageRun,
  installGenerationLock,
  seedFor,
  styleForScene,
  writeExactImage,
} from "./image-worker-common.mjs";
import {
  createImageGenerationAudit,
  selectRequestedScenes,
} from "./image-generation-audit.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const promptsFile = process.env.IMAGE_PROMPTS_FILE
  ? path.resolve(process.env.IMAGE_PROMPTS_FILE)
  : path.join(projectDir, "content", "image-prompts.json");
const prompts = await readJson(promptsFile);
const allScenes = prompts.filter((item) => item.kind !== "reference");
const selection = selectRequestedScenes(allScenes, flags);
const scenes = selection.scenes;
const gen = config.imageGen ?? {};
const releaseLock = await installGenerationLock(projectDir, flags.project);

const baseUrl = (process.env.DRAWTHINGS_BASE_URL ?? "http://127.0.0.1:7860").replace(/\/$/, "");
const sharedSecret = process.env.DRAWTHINGS_SHARED_SECRET;
const headers = {
  "Content-Type": "application/json",
  ...(sharedSecret ? { Authorization: `Bearer ${sharedSecret}` } : {}),
};
const endpoint = `${baseUrl}/sdapi/v1/txt2img`;
const model = String(gen.drawThingsModel ?? "illustrious_xl_v2.0_f16.ckpt");
const steps = Number(flags.steps ?? gen.steps ?? 30);
const guidance = Number(flags.guidance ?? flags.cfg ?? gen.guidanceScale ?? gen.cfg ?? 5.5);
const sampler = String(flags.sampler ?? gen.sampler ?? "Euler A AYS");
const shift = Number(flags.shift ?? gen.shift ?? 1);
const clipSkip = Number(flags["clip-skip"] ?? gen.clipSkip ?? 2);
const genWidth = Number(gen.genWidth ?? 1024);
const genHeight = Number(gen.genHeight ?? 576);
const outWidth = Number(gen.outWidth ?? config.width ?? 1920);
const outHeight = Number(gen.outHeight ?? config.height ?? 1080);
const loras = (Array.isArray(gen.loras) ? gen.loras : [])
  .filter((entry) => entry?.file)
  .map((entry) => ({
    file: String(entry.file),
    mode: String(entry.mode ?? "all"),
    weight: Number(entry.weight ?? 0.65),
  }));
const outputDir = path.join(projectDir, "public", "generated");
await fs.mkdir(outputDir, { recursive: true });

const statusResponse = await fetch(baseUrl, {
  headers: sharedSecret ? { Authorization: `Bearer ${sharedSecret}` } : {},
  signal: AbortSignal.timeout(5_000),
}).catch(() => null);
if (!statusResponse?.ok) {
  throw new Error(
    `Draw Things is not reachable at ${baseUrl}. Open Draw Things and enable its HTTP API server.`,
  );
}
const status = await statusResponse.json().catch(() => null);

function finalPromptFor(item) {
  return [
    String(item.prompt ?? "").trim(),
    styleForScene(item, gen.compactStyleSuffix ?? gen.styleSuffix ?? ""),
  ]
    .filter(Boolean)
    .join(", ");
}

function finalNegativePrompt() {
  return String(gen.negativeExtra ?? gen.negativePrompt ?? "").trim();
}

async function drawThingsImage({ prompt, negativePrompt, seed }) {
  const payload = {
    prompt,
    negative_prompt: negativePrompt,
    seed,
    steps,
    guidance_scale: guidance,
    sampler,
    shift,
    clip_skip: clipSkip,
    width: genWidth,
    height: genHeight,
    original_width: genWidth,
    original_height: genHeight,
    target_width: genWidth,
    target_height: genHeight,
    hires_fix: false,
    tiled_diffusion: false,
    batch_size: 1,
    batch_count: 1,
    model,
    loras,
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const detail = await response.text();
  if (!response.ok) {
    throw new Error(`Draw Things failed (${response.status}): ${detail.slice(0, 1000)}`);
  }
  const result = JSON.parse(detail);
  const encoded = String(result.images?.[0] ?? "").replace(
    /^data:image\/[a-z0-9.+-]+;base64,/i,
    "",
  );
  if (!encoded) throw new Error("Draw Things returned no image.");
  return {
    bytes: Buffer.from(encoded, "base64"),
    response: {
      status: "complete",
      imageCount: result.images.length,
    },
  };
}

const audit = await createImageGenerationAudit({
  projectDir,
  project: flags.project,
  provider: "drawthings",
  service: {
    type: "Draw Things HTTP API",
    baseUrl,
    endpoint: "/sdapi/v1/txt2img",
    reachable: true,
    activeModel: status?.model ?? null,
  },
  configuration: {
    model,
    loras,
    steps,
    guidance,
    sampler,
    shift,
    clipSkip,
    genWidth,
    genHeight,
    outWidth,
    outHeight,
    hiresFix: false,
    selectedScenes: selection.prefixes,
  },
  promptFile: promptsFile,
  prompts: scenes,
});

const manifest = [];
const startedAt = Date.now();
try {
  for (const [index, item] of scenes.entries()) {
    if (!item.id || !item.prompt) throw new Error("Every scene prompt needs an id and prompt.");
    const finalPath = path.join(outputDir, `${item.id}.png`);
    const prompt = finalPromptFor(item);
    const negativePrompt = finalNegativePrompt();
    const seed = Number(item.seed ?? seedFor(item.id));
    const settings = {
      model,
      loras,
      steps,
      guidance,
      sampler,
      shift,
      clipSkip,
      width: genWidth,
      height: genHeight,
      outWidth,
      outHeight,
      seed,
      hiresFix: false,
    };
    const exists = await fs.access(finalPath).then(() => true, () => false);
    await audit.startScene(item.id, {
      finalPrompt: prompt,
      seed,
      settings,
      references: [],
    });

    if (exists && !flags.force) {
      const entry = {
        id: item.id,
        file: `public/generated/${item.id}.png`,
        provider: "drawthings",
        model,
        seed,
        prompt,
        negativePrompt,
        settings,
        promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
        skipped: true,
      };
      manifest.push(entry);
      await audit.completeScene(item.id, { status: "reused", output: entry });
      console.log(`[${index + 1}/${scenes.length}] ${item.id} — already generated, skipping`);
      continue;
    }

    const itemStart = Date.now();
    try {
      const generated = await drawThingsImage({ prompt, negativePrompt, seed });
      await writeExactImage({
        bytes: generated.bytes,
        finalPath,
        outWidth,
        outHeight,
        postProcess: gen.postProcess ?? null,
      });
      const entry = {
        id: item.id,
        file: `public/generated/${item.id}.png`,
        provider: "drawthings",
        model,
        seed,
        prompt,
        negativePrompt,
        settings,
        promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
      };
      manifest.push(entry);
      await audit.completeScene(item.id, {
        output: entry,
        providerResponse: generated.response,
      });
    } catch (error) {
      await audit.failScene(item.id, error);
      await audit.fail(error);
      throw error;
    }
    console.log(
      `[${index + 1}/${scenes.length}] ${item.id} — ${((Date.now() - itemStart) / 1000).toFixed(1)}s`,
    );
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
      requests: manifest.filter((entry) => !entry.skipped).length,
      creditsUsed: 0,
      estimatedCost: 0,
      quotaNote: "Local Draw Things generation.",
    },
  });
  console.log(`Draw Things finished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s.`);
} catch (error) {
  if (audit.document.status !== "failed") await audit.fail(error);
  throw error;
} finally {
  releaseLock();
}
