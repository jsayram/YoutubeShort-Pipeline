import path from "node:path";
import { parseArgs, repoRoot, run } from "./lib.mjs";

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const shared = ["--project", flags.project];
if (flags.force) shared.push("--force");

if (!flags["skip-images"]) {
  await run(process.execPath, [path.join(repoRoot, "scripts", "generate-images.mjs"), ...shared]);
}

if (!flags["skip-voice"]) {
  const voiceArgs = [
    path.join(repoRoot, "scripts", "generate-story.mjs"),
    "--project",
    flags.project,
  ];
  if (flags.profile) voiceArgs.push("--profile", flags.profile);
  if (flags.engine) voiceArgs.push("--engine", flags.engine);
  if (flags.gap) voiceArgs.push("--gap", flags.gap);
  if (flags.resume) voiceArgs.push("--resume");
  if (flags.fit) voiceArgs.push("--fit");
  await run(process.execPath, voiceArgs);
}

console.log("Media is ready. Ask Codex or Claude to author and preview the HyperFrames composition.");

