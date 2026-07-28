import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, readJson, repoRoot, run, videoDir } from "./lib.mjs";

const { flags } = parseArgs();
if (!flags.approved) {
  throw new Error(
    "Preview the final video and get approval first, then rerun with --approved.",
  );
}
const slug = flags.project;
const projectDir = videoDir(slug);
const config = await readJson(path.join(projectDir, "video.json"));
const output = path.join(projectDir, "renders", `${slug}.mp4`);
await fs.mkdir(path.dirname(output), { recursive: true });

await run("npx", ["--yes", `hyperframes@${config.hyperframesVersion}`, "check"], {
  cwd: projectDir,
});
const renderArgs = [
  "--yes",
  `hyperframes@${config.hyperframesVersion}`,
  "render",
  "--quality",
  flags.quality ?? "high",
  "--fps",
  String(config.fps ?? 30),
  "--resolution",
  "portrait",
  "--strict",
  "--output",
  output,
];
// Docker mode pins the Chrome version and font set, so a re-render months from now matches the
// original. Slower, and it needs Docker running — worth it for a final master, not for iteration.
if (flags.docker) renderArgs.push("--docker");

await run("npx", renderArgs, { cwd: projectDir });
await run(process.execPath, [
  path.join(repoRoot, "scripts", "verify-video.mjs"),
  "--project",
  slug,
  "--file",
  output,
]);
