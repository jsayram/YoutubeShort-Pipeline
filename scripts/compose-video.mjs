import path from "node:path";
import { parseArgs, run, videoDir, readJson, repoRoot } from "./lib.mjs";

// Chooses the automatic composition that belongs to the project's saved content provider.
// Keeping this decision outside Studio means `npm run compose` and the browser use one path.

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const config = await readJson(path.join(videoDir(flags.project), "video.json"));
const preset = config.imageGen?.compositionPreset ?? "slideshow";
const composers = {
  slideshow: "compose-slideshow.mjs",
  "living-storybook": "compose-living-storybook.mjs",
};
const composer = composers[preset];

if (!composer) {
  throw new Error(
    `Unknown composition preset "${preset}". Available: ${Object.keys(composers).join(", ")}.`,
  );
}

const args = [path.join(repoRoot, "scripts", composer), "--project", flags.project];
if (flags.force) args.push("--force");
if (flags.tail !== undefined) args.push("--tail", String(flags.tail));

console.log(`Composition preset: ${preset}.`);
await run(process.execPath, args);
