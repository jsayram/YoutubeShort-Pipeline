import fs from "node:fs/promises";
import path from "node:path";
import {
  assertSlug,
  parseArgs,
  readJson,
  repoRoot,
  run,
  videoDir,
} from "./lib.mjs";

const { flags } = parseArgs();
const slug = assertSlug(flags.project);
const projectDir = videoDir(slug);
const config = await readJson(path.join(projectDir, "video.json"));
const finalCut = config.finalCut ?? {};
const bridgeRoot = path.resolve(
  String(
    flags.bridge ??
      process.env.FINAL_CUT_BRIDGE_DIR ??
      path.join(repoRoot, "..", "final-cut-youtube-bridge"),
  ),
);
const bridgeCli = path.join(bridgeRoot, "src", "cli.mjs");
const output = path.resolve(
  String(flags.output ?? path.join(projectDir, "final-cut", `${slug}.fcpxml`)),
);

await fs.access(bridgeCli).catch(() => {
  throw new Error(
    `Final Cut bridge not found at ${bridgeRoot}. ` +
      "Set FINAL_CUT_BRIDGE_DIR in .env if it was moved.",
  );
});

const args = [
  bridgeCli,
  "export",
  "--source",
  repoRoot,
  "--project",
  slug,
  "--channel",
  String(flags.channel ?? finalCut.channel ?? "default"),
  "--output",
  output,
];
if (flags["library-path"] ?? finalCut.libraryPath) {
  args.push("--library-path", String(flags["library-path"] ?? finalCut.libraryPath));
}
if (flags.music) args.push("--music", String(flags.music));
if (flags.sfx) args.push("--sfx", String(flags.sfx));
if (flags.open) args.push("--open");

await run(process.execPath, args, { cwd: bridgeRoot });
console.log(`Final Cut project: ${output}`);
