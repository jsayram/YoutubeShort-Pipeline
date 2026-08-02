import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, readJson, repoRoot, sleep } from "../scripts/lib.mjs";

await loadEnv();
const promptDoc = await readJson(path.join(repoRoot, "templates", "prompt.json"));
const profile = promptDoc.providers["pixar-pet-cartoon"];

const scene =
  "Two dogs sitting together side by side on a sunlit wooden porch, facing the camera. " +
  "The first is a miniature toy poodle with a beige/apricot curly coat. The second is its " +
  "friend, a poodle with a dark brown curly coat, slightly larger. Both look happy and " +
  "alert, tails wagging, warm golden-hour light.";

const prompt = `${scene}\n\n${profile.stylePrompt}`;

const baseUrl = "http://127.0.0.1:8188";
const diffusionModel = "flux-2-klein-4b.safetensors";
const textEncoder = "qwen_3_4b.safetensors";
const vaeName = "flux2-vae.safetensors";
const steps = 4;
const guidance = 1.5;
const sampler = "euler";
const width = 1344;
const height = 768;
const seed = Math.floor(Math.random() * 1_000_000_000);

function workflowFor() {
  return {
    model: { class_type: "UNETLoader", inputs: { unet_name: diffusionModel, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: textEncoder, type: "flux2", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: vaeName } },
    text: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["clip", 0] } },
    negative: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["text", 0] } },
    latent: { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } },
    sigmas: { class_type: "Flux2Scheduler", inputs: { steps, width, height } },
    guider: {
      class_type: "CFGGuider",
      inputs: { model: ["model", 0], positive: ["text", 0], negative: ["negative", 0], cfg: guidance },
    },
    sample: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler", 0],
        sigmas: ["sigmas", 0],
        latent_image: ["latent", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    save: {
      class_type: "SaveImage",
      inputs: { filename_prefix: "ytshort/scratch/pixar-poodles", images: ["decode", 0] },
    },
  };
}

const response = await fetch(`${baseUrl}/prompt`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: workflowFor(), client_id: "youtube-pipeline-scratch" }),
});
if (!response.ok) throw new Error(`ComfyUI rejected: ${await response.text()}`);
const queued = await response.json();
if (queued.node_errors && Object.keys(queued.node_errors).length) {
  throw new Error(`ComfyUI node errors: ${JSON.stringify(queued.node_errors)}`);
}

const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  const history = await fetch(`${baseUrl}/history/${queued.prompt_id}`).then((item) => item.json());
  const entry = history[queued.prompt_id];
  if (entry?.status?.status_str === "error") {
    const message = (entry.status.messages ?? [])
      .filter(([kind]) => kind === "execution_error")
      .map(([, detail]) => detail.exception_message)
      .join("; ");
    throw new Error(message || "ComfyUI failed.");
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
      if (!file.ok) throw new Error("Could not download image.");
      const bytes = Buffer.from(await file.arrayBuffer());
      const outputPath = path.join(repoRoot, "scratch", "pixar-poodles.png");
      await fs.writeFile(outputPath, bytes);
      console.log("Saved", outputPath);
      process.exit(0);
    }
    throw new Error("ComfyUI completed without an image.");
  }
  await sleep(1500);
}
throw new Error("ComfyUI timed out.");
