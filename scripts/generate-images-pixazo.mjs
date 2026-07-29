import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, parseArgs, readJson, videoDir } from "./lib.mjs";
import {
  buildFluxPrompt,
  finishImageRun,
  installGenerationLock,
  seedFor,
  writeExactImage,
} from "./image-worker-common.mjs";
import {
  createImageGenerationAudit,
  selectRequestedScenes,
} from "./image-generation-audit.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const apiKey = process.env.PIXAZO_API ?? process.env.PIXAZO_API_KEY;
if (!apiKey) {
  throw new Error(
    "Pixazo SDXL needs PIXAZO_API (or PIXAZO_API_KEY) in .env.",
  );
}

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const promptsFile = process.env.IMAGE_PROMPTS_FILE
  ? path.resolve(process.env.IMAGE_PROMPTS_FILE)
  : path.join(projectDir, "content", "image-prompts.json");
const allPrompts = await readJson(promptsFile);
const allScenes = allPrompts.filter((item) => item.kind !== "reference");
const selection = selectRequestedScenes(allScenes, flags);
const scenes = selection.scenes;
const gen = config.imageGen ?? {};
const releaseLock = await installGenerationLock(projectDir, flags.project);

// Pixazo documents SDXL Base 1.0 as free during preview. The free tier supports images up to
// 1024px, so render a near-vertical source and deterministically fit it to the project's exact
// 9:16 output. These can still be overridden in video.json for a future paid tier.
const endpoint = "https://gateway.pixazo.ai/getImage/v1/getSDXLImage";
const model = "Stable Diffusion XL Base 1.0";
const sceneWidth = Number(gen.genWidth ?? 576);
const sceneHeight = Number(gen.genHeight ?? 1024);
const outWidth = Number(gen.outWidth ?? config.width ?? 1080);
const outHeight = Number(gen.outHeight ?? config.height ?? 1920);
const steps = Number(flags.steps ?? gen.numSteps ?? gen.steps ?? 20);
const guidance = Number(flags.guidance ?? gen.guidanceScale ?? gen.guidance ?? 5);
const outputDir = path.join(projectDir, "public", "generated");
await fs.mkdir(outputDir, { recursive: true });

function finalPromptFor(item) {
  return buildFluxPrompt(item, gen.compactStyleSuffix ?? gen.styleSuffix);
}

function finalNegativePrompt() {
  return String(gen.negativeExtra ?? "").trim();
}

function imageUrlFrom(payload) {
  const candidate =
    payload?.imageUrl ??
    payload?.output ??
    payload?.result?.imageUrl ??
    payload?.result?.output ??
    payload?.output?.media_url?.[0];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function safeMediaDescriptor(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "Pixazo-hosted image";
  }
}

async function pixazoImage({ prompt, negativePrompt, seed }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": apiKey,
    },
    body: JSON.stringify({
      prompt,
      negative_prompt: negativePrompt,
      height: sceneHeight,
      width: sceneWidth,
      num_steps: steps,
      guidance_scale: guidance,
      seed,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const detail = await response.text();
  let payload;
  try {
    payload = JSON.parse(detail);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(
      `Pixazo SDXL failed (${response.status}): ${payload?.message ?? detail.slice(0, 600)}`,
    );
  }
  const imageUrl = imageUrlFrom(payload);
  if (!imageUrl) {
    throw new Error(
      `Pixazo SDXL returned no image URL (status: ${payload?.status ?? "unknown"}).`,
    );
  }
  const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(180_000) });
  if (!imageResponse.ok) {
    throw new Error(`Pixazo image download failed (${imageResponse.status}).`);
  }
  return {
    bytes: Buffer.from(await imageResponse.arrayBuffer()),
    response: {
      status: payload?.status ?? "complete",
      message: payload?.message ?? null,
      media: safeMediaDescriptor(imageUrl),
      contentType: imageResponse.headers.get("content-type") ?? null,
    },
  };
}

const audit = await createImageGenerationAudit({
  projectDir,
  project: flags.project,
  provider: "pixazo-sdxl",
  service: {
    type: "Pixazo API",
    endpoint,
    model,
    credentialsPresent: true,
    billing: "free preview tier; fair-use limits apply",
  },
  configuration: {
    model,
    sceneWidth,
    sceneHeight,
    outWidth,
    outHeight,
    steps,
    guidance,
    selectedScenes: selection.prefixes,
    promptPolicy: {
      sceneAuthority: "enriched concrete scene",
      styleAuthority: "selected compact look profile",
      textBearingProps: "preserved with a wordless glow, light pulse, or abstract pictorial mark",
      readableText: "forbidden in both the positive hard requirement and negative prompt",
      negativeConditioning: "Pixazo SDXL negative_prompt",
    },
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
      width: sceneWidth,
      height: sceneHeight,
      outWidth,
      outHeight,
      steps,
      guidance,
      seed,
      negativePrompt,
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
        provider: "pixazo-sdxl",
        model,
        seed,
        prompt,
        negativePrompt,
        promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
        skipped: true,
      };
      manifest.push(entry);
      await audit.completeScene(item.id, { status: "reused", output: entry });
      console.log(`[${index + 1}/${scenes.length}] ${item.id} — already generated, skipping`);
      continue;
    }

    const itemStart = Date.now();
    let generated;
    try {
      generated = await pixazoImage({ prompt, negativePrompt, seed });
      await writeExactImage({
        bytes: generated.bytes,
        finalPath,
        outWidth,
        outHeight,
        postProcess: gen.postProcess ?? null,
      });
    } catch (error) {
      await audit.failScene(item.id, error);
      await audit.fail(error);
      throw error;
    }

    const entry = {
      id: item.id,
      file: `public/generated/${item.id}.png`,
      provider: "pixazo-sdxl",
      model,
      seed,
      steps,
      guidance,
      prompt,
      negativePrompt,
      promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
    };
    manifest.push(entry);
    await audit.completeScene(item.id, {
      output: entry,
      providerResponse: generated.response,
    });
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
  });
  console.log(
    `Pixazo SDXL finished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s.`,
  );
} catch (error) {
  if (audit.document.status !== "failed") await audit.fail(error);
  throw error;
} finally {
  releaseLock();
}
