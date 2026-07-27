import fs from "node:fs/promises";
import path from "node:path";
import {
  assertSlug,
  parseArgs,
  readJson,
  repoRoot,
  run,
  videoDir,
  writeJson,
} from "./lib.mjs";

const { flags, positionals } = parseArgs();
const slug = assertSlug(positionals[0]);
const destination = videoDir(slug);
const templateConfig = await readJson(path.join(repoRoot, "templates", "video.json"));
const version = templateConfig.hyperframesVersion;

if (flags["dry-run"]) {
  console.log(`Would create ${destination}`);
  console.log(`Would use hyperframes@${version}`);
  process.exit(0);
}

try {
  await fs.access(destination);
  throw new Error(`Video project already exists: ${destination}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await fs.mkdir(path.dirname(destination), { recursive: true });
await run(
  "npx",
  [
    "--yes",
    `hyperframes@${version}`,
    "init",
    destination,
    "--non-interactive",
    "--example=blank",
    "--resolution=portrait",
  ],
  { cwd: repoRoot },
);

await fs.mkdir(path.join(destination, "content"), { recursive: true });
await fs.mkdir(path.join(destination, "public", "generated"), { recursive: true });
await fs.mkdir(path.join(destination, "public", "audio"), { recursive: true });

for (const name of ["narration.txt", "image-prompts.json", "STYLE.md", "PIPELINE.md"]) {
  await fs.copyFile(path.join(repoRoot, "templates", name), path.join(destination, "content", name));
}

await fs.writeFile(path.join(destination, "public", "generated", ".gitkeep"), "");
await fs.writeFile(path.join(destination, "public", "audio", ".gitkeep"), "");

templateConfig.title = slug
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");
await writeJson(path.join(destination, "video.json"), templateConfig);

console.log(`Created ${destination}`);
console.log(`Next: edit videos/${slug}/content and videos/${slug}/video.json`);
