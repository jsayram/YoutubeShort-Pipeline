import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { loadEnv, parseArgs, readJson, repoRoot, run, videoDir } from "./lib.mjs";
import { localLlmStatus } from "./local-llm.mjs";

// Dispatcher. `imageGen.provider` in video.json decides which backend renders the stills:
//   "comfyui" — local ComfyUI over HTTP. Offline, no key, no quota. The default.
//   "gemini"  — Google GenAI. Needs GEMINI_API_KEY and a billed project; image generation
//               has a zero free-tier allowance, so an unbilled key fails with 429 limit:0.
//   "drawthings" — Draw Things' local HTTP API. Native Apple Silicon inference.
//   "flux2-local" — FLUX.2 Klein through ComfyUI, with optional Cloudflare fallback.
//   "cloudflare-flux2" — FLUX.2 Klein through Cloudflare Workers AI.
//   "pixazo-sdxl" — Pixazo's free-preview Stable Diffusion XL Base 1.0 endpoint.

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
  drawthings: "generate-images-drawthings.mjs",
  "draw-things": "generate-images-drawthings.mjs",
  "flux2-local": "generate-images-flux2.mjs",
  flux2: "generate-images-flux2.mjs",
  "cloudflare-flux2": "generate-images-cloudflare.mjs",
  "pixazo-sdxl": "generate-images-pixazo.mjs",
  pixazo: "generate-images-pixazo.mjs",
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
const basePromptsPath = path.join(projectPath, "content", "image-prompts.json");
const [savedOverlay, basePrompts] = await Promise.all([
  readJson(enrichedPath).catch(() => null),
  readJson(basePromptsPath),
]);

function overlayMatchesCurrentSource(overlay, source) {
  if (!Array.isArray(overlay) || !overlay.length || !Array.isArray(source)) return false;
  const byId = new Map(source.map((item) => [item.id, item]));
  return (
    overlay.length === source.length &&
    overlay.every((item) => {
      const current = byId.get(item.id);
      return current && item.enrichment?.sourcePrompt === current.prompt;
    })
  );
}

const reusableOverlay = overlayMatchesCurrentSource(savedOverlay, basePrompts);
let promptOverlay = null;
let enrichment = {
  enabled: config.imageGen?.enrichWithLLM === true,
  status: "disabled",
  service: null,
  error: null,
};

if (flags["reuse-enriched"] === true) {
  if (!Array.isArray(savedOverlay) || !savedOverlay.length) {
    throw new Error(
      `--reuse-enriched was requested, but ${enrichedRelativePath} does not contain an overlay.`,
    );
  }
  promptOverlay = enrichedPath;
  const prior = savedOverlay.find((item) => item.enrichment)?.enrichment;
  enrichment = {
    enabled: true,
    status: "reused",
    service: prior
      ? {
          provider: prior.provider,
          name: prior.service,
          model: prior.model,
        }
      : null,
    error: null,
    overlayCreatedAt: prior?.generatedAt ?? null,
  };
  console.log(`Reusing exact enriched overlay: ${enrichedRelativePath}`);
} else if (
  config.imageGen?.enrichWithLLM === true &&
  flags["refresh-enriched"] !== true &&
  reusableOverlay
) {
  promptOverlay = enrichedPath;
  const prior = savedOverlay.find((item) => item.enrichment)?.enrichment;
  enrichment = {
    enabled: true,
    status: "reused",
    service: prior
      ? {
          provider: prior.provider,
          name: prior.service,
          model: prior.model,
        }
      : null,
    error: null,
    overlayCreatedAt: prior?.generatedAt ?? null,
  };
  console.log(
    `Using the approved enriched overlay: ${enrichedRelativePath}. ` +
      "Pass --refresh-enriched to ask the LLM for new scene descriptions.",
  );
} else if (config.imageGen?.enrichWithLLM === true) {
  const llm = await localLlmStatus();
  enrichment.service = {
    provider: llm.provider,
    name: llm.name,
    baseUrl: llm.baseUrl,
    model: llm.model,
    reachable: llm.reachable,
    modelReady: llm.modelReady,
    modelsSeen: llm.models,
  };

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
      enrichment.status = "completed";
    } catch (error) {
      enrichment.status = "failed";
      enrichment.error = {
        name: error.name ?? "Error",
        message: String(error.message ?? error),
      };
      console.log(
        `⚠ ${llm.name} could not complete enrichment. ` +
          "Continuing with the provider's normal prompts.",
      );
    }
  } else {
    enrichment.status = "unavailable";
    console.log(
      `⚠ LLM prompt enrichment is on, but ${llm.name} or model "${llm.model}" is unavailable. ` +
        "Using the provider's normal prompts.",
    );
  }
} else {
  console.log("LLM prompt enrichment is off. Using the provider's normal prompts.");
}

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const auditContextPath = path.join(projectPath, "content", ".image-run-context.json");
const auditContext = {
  version: 1,
  runId,
  project: flags.project,
  provider,
  startedAt: new Date().toISOString(),
  invocation: {
    command: process.execPath,
    arguments: process.argv.slice(1),
  },
  enrichment,
};
await fs.writeFile(
  auditContextPath,
  `${JSON.stringify(auditContext, null, 2)}\n`,
);

try {
  await run(process.execPath, [path.join(repoRoot, "scripts", script), ...forwarded], {
    // The provider-built prompt file is never touched. Backends read this optional overlay only
    // for this child process, so cancelling or disabling the feature needs no cleanup.
    env: {
      ...(promptOverlay ? { IMAGE_PROMPTS_FILE: promptOverlay } : {}),
      IMAGE_AUDIT_CONTEXT: auditContextPath,
    },
  });
} catch (error) {
  auditContext.completedAt = new Date().toISOString();
  auditContext.status = "failed";
  auditContext.error = {
    name: error.name ?? "Error",
    message: String(error.message ?? error),
    stack: error.stack ?? null,
  };
  await fs.writeFile(auditContextPath, `${JSON.stringify(auditContext, null, 2)}\n`);
  const auditDir = path.join(projectPath, "public", "generated", "audit");
  const auditPath = path.join(auditDir, `${runId}.json`);
  const exists = await fs.access(auditPath).then(() => true, () => false);
  if (!exists) {
    await fs.mkdir(auditDir, { recursive: true });
    await fs.writeFile(auditPath, `${JSON.stringify(auditContext, null, 2)}\n`);
    await fs.writeFile(path.join(auditDir, "latest.json"), `${JSON.stringify(auditContext, null, 2)}\n`);
  }
  throw error;
}
