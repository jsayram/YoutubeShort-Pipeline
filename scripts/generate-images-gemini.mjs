import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import {
  loadEnv,
  parseArgs,
  readJson,
  videoDir,
  writeJson,
} from "./lib.mjs";
import {
  createImageGenerationAudit,
  mergePartialManifest,
  selectRequestedScenes,
} from "./image-generation-audit.mjs";
import { buildGeminiPrompt } from "./image-worker-common.mjs";

await loadEnv();
const { flags } = parseArgs();
const slug = flags.project;
const projectDir = videoDir(slug);
const config = await readJson(path.join(projectDir, "video.json"));
const promptsFile = process.env.IMAGE_PROMPTS_FILE
  ? path.resolve(process.env.IMAGE_PROMPTS_FILE)
  : path.join(projectDir, "content", "image-prompts.json");
const allPrompts = await readJson(promptsFile);
const selection = selectRequestedScenes(allPrompts, flags);
const prompts = selection.scenes;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Copy .env.example to .env and add the key.");
if (!Array.isArray(prompts) || prompts.length === 0) {
  throw new Error("content/image-prompts.json must contain at least one prompt.");
}

const ai = new GoogleGenAI({ apiKey });
const outputDir = path.join(projectDir, "public", "generated");
await fs.mkdir(outputDir, { recursive: true });
const manifest = [];
const generatedExtensions = ["png", "jpg", "jpeg", "webp"];

function finalPromptFor(item) {
  return buildGeminiPrompt(
    item,
    config.imageGen.compactStyleSuffix ?? config.imageGen.styleSuffix,
  );
}

const audit = await createImageGenerationAudit({
  projectDir,
  project: slug,
  provider: "gemini",
  service: {
    type: "Google GenAI",
    endpoint: "Google GenAI interactions API",
    credentialsPresent: Boolean(apiKey),
  },
  configuration: {
    model: config.imageGen.model,
    aspectRatio: config.imageGen.aspectRatio,
    imageSize: config.imageGen.imageSize,
    selectedScenes: selection.prefixes,
    promptPolicy: {
      sceneAuthority: "enriched concrete scene",
      textBearingProps: "preserved with a wordless glow, light pulse, or abstract pictorial mark",
      readableText: "wordless hard requirement in the submitted prompt",
    },
  },
  promptFile: promptsFile,
  prompts,
});

function findImage(interaction) {
  const blocks = [];
  for (const step of interaction.steps ?? []) blocks.push(...(step.content ?? []));
  blocks.push(...(interaction.outputs ?? []));
  for (const candidate of interaction.candidates ?? []) {
    blocks.push(...(candidate.content?.parts ?? []));
  }

  for (const block of blocks) {
    if (block.type === "image" && block.data) {
      return { data: block.data, mimeType: block.mime_type ?? "image/jpeg" };
    }
    if (block.inlineData?.data) {
      return {
        data: block.inlineData.data,
        mimeType: block.inlineData.mimeType ?? "image/png",
      };
    }
  }
  return null;
}

try {
for (const item of prompts) {
  if (!item.id || !item.prompt) throw new Error("Every image prompt needs an id and prompt.");
  if (!flags.force) {
    for (const extension of generatedExtensions) {
      const existingPath = path.join(outputDir, `${item.id}.${extension}`);
      try {
        await fs.access(existingPath);
        manifest.push({
          id: item.id,
          file: `public/generated/${item.id}.${extension}`,
          skipped: true,
          prompt: finalPromptFor(item),
          promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
        });
        await audit.startScene(item.id, {
          finalPrompt: finalPromptFor(item),
          settings: {
            model: config.imageGen.model,
            aspectRatio: config.imageGen.aspectRatio,
            imageSize: config.imageGen.imageSize,
          },
        });
        await audit.completeScene(item.id, { status: "reused", output: manifest.at(-1) });
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (manifest.at(-1)?.id === item.id) continue;
  }

  // Gemini follows instructions rather than CLIP-style conditioning, so negation stays as
  // prose here — but it is stated once, last, and unambiguously. The frames must come back
  // wordless; captions are added over them in the composition.
  const fullPrompt = finalPromptFor(item);
  await audit.startScene(item.id, {
    finalPrompt: fullPrompt,
    settings: {
      model: config.imageGen.model,
      aspectRatio: config.imageGen.aspectRatio,
      imageSize: config.imageGen.imageSize,
    },
  });
  let interaction;
  try {
    interaction = await ai.interactions.create({
      model: config.imageGen.model,
      input: fullPrompt,
      response_format: {
        type: "image",
        aspect_ratio: config.imageGen.aspectRatio,
        image_size: config.imageGen.imageSize,
      },
    });
  } catch (error) {
    await audit.failScene(item.id, error);
    await audit.fail(error);
    if (String(error).includes("429") || String(error).toLowerCase().includes("quota")) {
      throw new Error(
        "Google image quota is unavailable for this project. Enable billing/quota or create the image in Gemini and save it under public/generated with the expected filename.",
      );
    }
    throw error;
  }

  const image = findImage(interaction);
  if (!image) throw new Error(`Google returned no image for prompt ${item.id}.`);
  const extension = image.mimeType.includes("png") ? "png" : "jpg";
  const outputPath = path.join(outputDir, `${item.id}.${extension}`);
  await fs.writeFile(outputPath, Buffer.from(image.data, "base64"));
  // Imported projects can contain a different extension from the one Gemini returns. Remove the
  // older variant only after the replacement has been written successfully; otherwise Studio's
  // PNG-first preview could keep showing the stale imported file after a forced regeneration.
  for (const oldExtension of generatedExtensions) {
    if (oldExtension === extension) continue;
    await fs.rm(path.join(outputDir, `${item.id}.${oldExtension}`), { force: true });
  }
  manifest.push({
    id: item.id,
    file: `public/generated/${item.id}.${extension}`,
    model: config.imageGen.model,
    prompt: fullPrompt,
    promptSource: process.env.IMAGE_PROMPTS_FILE ? "enriched-overlay" : "base",
  });
  await audit.completeScene(item.id, {
    output: manifest.at(-1),
    providerResponse: {
      mimeType: image.mimeType,
      interactionId: interaction.id ?? null,
    },
  });
  console.log(`Saved ${outputPath}`);
}

const finalManifest = selection.partial
  ? await mergePartialManifest(projectDir, manifest)
  : manifest;
await writeJson(path.join(outputDir, "manifest.json"), finalManifest);
await audit.finish("completed", {
  manifest: "public/generated/manifest.json",
  generated: manifest.filter((entry) => !entry.skipped).length,
  reused: manifest.filter((entry) => entry.skipped).length,
});
} catch (error) {
  if (audit.document.status !== "failed") await audit.fail(error);
  throw error;
}
