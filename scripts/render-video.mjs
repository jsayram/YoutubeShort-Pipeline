import fs from "node:fs/promises";
import path from "node:path";
import {
  parseArgs,
  readJson,
  repoRoot,
  resolveHyperframesVersion,
  run,
  videoDir,
  writeJson,
} from "./lib.mjs";

const { flags } = parseArgs();
if (!flags.approved) {
  throw new Error(
    "Preview the final video and get approval first, then rerun with --approved.",
  );
}
const slug = flags.project;
const projectDir = videoDir(slug);
const configPath = path.join(projectDir, "video.json");
const config = await readJson(configPath);
const hyperframesVersion = await resolveHyperframesVersion(config);
if (config.hyperframesVersion !== hyperframesVersion) {
  config.hyperframesVersion = hyperframesVersion;
  await writeJson(configPath, config);
  console.log(`Repaired missing HyperFrames version: ${hyperframesVersion}.`);
}
const output = path.join(projectDir, "renders", `${slug}.mp4`);
const rawOutput = path.join(projectDir, "renders", `.${slug}.hyperframes-${process.pid}.mp4`);
await fs.mkdir(path.dirname(output), { recursive: true });

await run("npx", ["--yes", `hyperframes@${hyperframesVersion}`, "check"], {
  cwd: projectDir,
});
const renderArgs = [
  "--yes",
  `hyperframes@${hyperframesVersion}`,
  "render",
  "--quality",
  flags.quality ?? "high",
  "--fps",
  String(config.fps ?? 30),
  "--resolution",
  "portrait",
  "--strict",
  "--output",
  rawOutput,
];
// Docker mode pins the Chrome version and font set, so a re-render months from now matches the
// original. Slower, and it needs Docker running — worth it for a final master, not for iteration.
if (flags.docker) renderArgs.push("--docker");

try {
  await run("npx", renderArgs, { cwd: projectDir });
  await run(process.execPath, [
    path.join(repoRoot, "scripts", "deliver-video.mjs"),
    "--project",
    slug,
    "--file",
    rawOutput,
    "--output",
    output,
  ]);
} finally {
  await fs.rm(rawOutput, { force: true }).catch(() => {});
}
