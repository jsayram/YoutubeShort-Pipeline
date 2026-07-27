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
await run(
  "npx",
  [
    "--yes",
    `hyperframes@${config.hyperframesVersion}`,
    "render",
    "--quality",
    flags.quality ?? "high",
    "--resolution",
    "portrait",
    "--strict",
    "--output",
    output,
  ],
  { cwd: projectDir },
);
await run(process.execPath, [
  path.join(repoRoot, "scripts", "verify-video.mjs"),
  "--project",
  slug,
  "--file",
  output,
]);
