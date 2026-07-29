import path from "node:path";
import { loadEnv, parseArgs, readJson, repoRoot, run, videoDir } from "./lib.mjs";
import { localLlmStatus } from "./local-llm.mjs";

// Dispatcher. `imageGen.provider` in video.json decides which backend renders the stills:
//   "comfyui" — local ComfyUI over HTTP. Offline, no key, no quota. The default.
//   "gemini"  — Google GenAI. Needs GEMINI_API_KEY and a billed project; image generation
//               has a zero free-tier allowance, so an unbilled key fails with 429 limit:0.
//   "flux2-local" — FLUX.2 Klein through ComfyUI, with optional Cloudflare fallback.
//   "cloudflare-flux2" — FLUX.2 Klein through Cloudflare Workers AI.

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectPath = videoDir(flags.project);
const config = await readJson(path.join(projectPath, "video.json"));
const provider = flags.provider ?? config.imageGen?.provider ?? "comfyui";

const backends = {
  comfyui: "generate-images-local.mjs",
  local: "generate-images-local.mjs",
  gemini: "generate-images-gemini.mjs",
  google: "generate-images-gemini.mjs",
  "flux2-local": "generate-images-flux2.mjs",
  flux2: "generate-images-flux2.mjs",
  "cloudflare-flux2": "generate-images-cloudflare.mjs",
};

const script = backends[provider];
if (!script) {
  throw new Error(
    `Unknown image provider "${provider}". Use one of: ${[...new Set(Object.keys(backends))].join(", ")}.`,
  );
}

const forwarded = process.argv.slice(2).filter((argument, index, all) => {
  if (argument === "--provider") return false;
  if (all[index - 1] === "--provider") return false;
  return !argument.startsWith("--provider=");
});

console.log(`Image provider: ${provider}`);

const enrichedRelativePath = path.join("content", "image-prompts.enriched.json");
const enrichedPath = path.join(projectPath, enrichedRelativePath);
let promptOverlay = null;

if (config.imageGen?.enrichWithLLM === true) {
  const llm = await localLlmStatus();

  if (llm.reachable && llm.modelReady) {
    console.log(
      `LLM prompt enrichment is on (${llm.name} · ${llm.model}). ` +
        "Building a temporary scene overlay…",
    );
    try {
      await run(process.execPath, [
        path.join(repoRoot, "scripts", "enrich-prompts.mjs"),
        "--project",
        flags.project,
        "--output",
        enrichedRelativePath,
      ]);
      promptOverlay = enrichedPath;
    } catch {
      console.log(
        `⚠ ${llm.name} could not complete enrichment. ` +
          "Continuing with the provider's normal prompts.",
      );
    }
  } else {
    console.log(
      `⚠ LLM prompt enrichment is on, but ${llm.name} or model "${llm.model}" is unavailable. ` +
        "Using the provider's normal prompts.",
    );
  }
} else {
  console.log("LLM prompt enrichment is off. Using the provider's normal prompts.");
}

await run(process.execPath, [path.join(repoRoot, "scripts", script), ...forwarded], {
  // The provider-built prompt file is never touched. Backends read this optional overlay only
  // for this child process, so cancelling or disabling the feature needs no cleanup.
  env: promptOverlay ? { IMAGE_PROMPTS_FILE: promptOverlay } : {},
});
