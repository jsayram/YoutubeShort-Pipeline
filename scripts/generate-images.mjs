import path from "node:path";
import { parseArgs, readJson, repoRoot, run, videoDir } from "./lib.mjs";

// Dispatcher. `imageGen.provider` in video.json decides which backend renders the stills:
//   "comfyui" — local ComfyUI over HTTP. Offline, no key, no quota. The default.
//   "gemini"  — Google GenAI. Needs GEMINI_API_KEY and a billed project; image generation
//               has a zero free-tier allowance, so an unbilled key fails with 429 limit:0.

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const config = await readJson(path.join(videoDir(flags.project), "video.json"));
const provider = flags.provider ?? config.imageGen?.provider ?? "comfyui";

const backends = {
  comfyui: "generate-images-local.mjs",
  local: "generate-images-local.mjs",
  gemini: "generate-images-gemini.mjs",
  google: "generate-images-gemini.mjs",
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
await run(process.execPath, [path.join(repoRoot, "scripts", script), ...forwarded]);
