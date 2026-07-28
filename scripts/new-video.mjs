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

// On-screen material the agent can reach for. hyperframes.json already points its asset path
// here, so anything dropped in these folders is addressable from the composition.
for (const name of ["logos", "clips", "fonts"]) {
  await fs.mkdir(path.join(destination, "assets", name), { recursive: true });
  await fs.writeFile(path.join(destination, "assets", name, ".gitkeep"), "");
}

for (const name of ["narration.txt", "image-prompts.json", "PIPELINE.md"]) {
  await fs.copyFile(path.join(repoRoot, "templates", name), path.join(destination, "content", name));
}

// design.md sits at the project root, not under content/. It is the spec the whole build is
// held against — stills, composition, captions, and motion — so it stays the first file you
// see when you open the project.
await fs.copyFile(path.join(repoRoot, "templates", "design.md"), path.join(destination, "design.md"));

await fs.writeFile(path.join(destination, "public", "generated", ".gitkeep"), "");
await fs.writeFile(path.join(destination, "public", "audio", ".gitkeep"), "");

templateConfig.title = slug
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");
await writeJson(path.join(destination, "video.json"), templateConfig);

console.log(`Created ${destination}`);
console.log(`Next: fill in videos/${slug}/design.md, then edit content/ and video.json`);
