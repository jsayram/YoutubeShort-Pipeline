import path from "node:path";
import { loadEnv, parseArgs, readJson, repoRoot, run, videoDir } from "./lib.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const config = await readJson(path.join(videoDir(flags.project), "video.json"));
const gen = config.imageGen ?? {};
const baseUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const required = {
  diffusionModel: gen.diffusionModel ?? "flux-2-klein-4b.safetensors",
  textEncoder: gen.textEncoder ?? "qwen_3_4b.safetensors",
  vae: gen.vae ?? "flux2-vae.safetensors",
};

async function choices(nodeClass, field) {
  const response = await fetch(`${baseUrl}/object_info/${nodeClass}`).catch(() => null);
  if (!response?.ok) return [];
  const value = await response.json();
  return value?.[nodeClass]?.input?.required?.[field]?.[0] ?? [];
}

const [models, encoders, vaes] = await Promise.all([
  choices("UNETLoader", "unet_name"),
  choices("CLIPLoader", "clip_name"),
  choices("VAELoader", "vae_name"),
]);
const localReady =
  models.includes(required.diffusionModel) &&
  encoders.includes(required.textEncoder) &&
  vaes.includes(required.vae);
const cloudReady = Boolean(
  process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN,
);
const forwarded = process.argv.slice(2);

if (localReady) {
  console.log("FLUX.2 route: local ComfyUI");
  try {
    await run(process.execPath, [
      path.join(repoRoot, "scripts", "generate-images-flux2-local.mjs"),
      ...forwarded,
    ]);
    process.exit(0);
  } catch (error) {
    if (!cloudReady || gen.fallbackProvider !== "cloudflare-flux2") throw error;
    console.warn("Local FLUX.2 failed. Continuing unfinished scenes with Cloudflare fallback.");
  }
} else if (!cloudReady || gen.fallbackProvider !== "cloudflare-flux2") {
  throw new Error(
    "Local FLUX.2 models are unavailable and the Cloudflare fallback is not configured.",
  );
} else {
  console.log("FLUX.2 route: Cloudflare fallback (local model unavailable)");
}

await run(process.execPath, [
  path.join(repoRoot, "scripts", "generate-images-cloudflare.mjs"),
  ...forwarded,
]);
