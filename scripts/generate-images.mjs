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

await loadEnv();
const { flags } = parseArgs();
const slug = flags.project;
const projectDir = videoDir(slug);
const config = await readJson(path.join(projectDir, "video.json"));
const prompts = await readJson(path.join(projectDir, "content", "image-prompts.json"));
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Copy .env.example to .env and add the key.");
if (!Array.isArray(prompts) || prompts.length === 0) {
  throw new Error("content/image-prompts.json must contain at least one prompt.");
}

const ai = new GoogleGenAI({ apiKey });
const outputDir = path.join(projectDir, "public", "generated");
await fs.mkdir(outputDir, { recursive: true });
const manifest = [];

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

for (const item of prompts) {
  if (!item.id || !item.prompt) throw new Error("Every image prompt needs an id and prompt.");
  if (!flags.force) {
    for (const extension of ["jpg", "png"]) {
      const existingPath = path.join(outputDir, `${item.id}.${extension}`);
      try {
        await fs.access(existingPath);
        manifest.push({
          id: item.id,
          file: `public/generated/${item.id}.${extension}`,
          skipped: true,
        });
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (manifest.at(-1)?.id === item.id) continue;
  }

  const fullPrompt = `${item.prompt}\n\n${config.imageGen.styleSuffix}`;
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
  manifest.push({
    id: item.id,
    file: `public/generated/${item.id}.${extension}`,
    model: config.imageGen.model,
    prompt: fullPrompt,
  });
  console.log(`Saved ${outputPath}`);
}

await writeJson(path.join(outputDir, "manifest.json"), manifest);
