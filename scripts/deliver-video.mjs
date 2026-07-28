import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import {
  commandOutput,
  loadEnv,
  parseArgs,
  repoRoot,
  run,
  videoDir,
} from "./lib.mjs";

await loadEnv();

const { flags } = parseArgs();
const slug = flags.project;
const projectDir = videoDir(slug);
const rendersDir = path.join(projectDir, "renders");
const source = path.resolve(flags.file ?? path.join(rendersDir, `${slug}.mp4`));
const output = path.resolve(flags.output ?? path.join(rendersDir, `${slug}.mp4`));
const deliveryRoot = await resolveDeliveryRoot(flags.destination);
const readyDir = path.join(deliveryRoot, "ready");
const publishedDir = path.join(deliveryRoot, "published");

await fs.mkdir(rendersDir, { recursive: true });
await fs.mkdir(readyDir, { recursive: true });
await fs.mkdir(publishedDir, { recursive: true });
await fs.access(source, fsConstants.R_OK);

const cleanTemp = path.join(
  path.dirname(output),
  `.${path.basename(output, path.extname(output))}.metadata-clean-${process.pid}-${Date.now()}.mp4`,
);

try {
  // Stream-copying preserves the encoded picture and sound exactly. bitexact prevents FFmpeg from
  // adding its own encoder tag after all source metadata and chapter records have been dropped.
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-map",
    "0",
    "-map_metadata",
    "-1",
    "-map_metadata:s",
    "-1",
    "-map_chapters",
    "-1",
    "-c",
    "copy",
    "-fflags",
    "+bitexact",
    "-movflags",
    "+faststart",
    cleanTemp,
  ]);

  await assertMetadataRemoved(cleanTemp);
  await fs.rename(cleanTemp, output);
} catch (error) {
  await fs.rm(cleanTemp, { force: true }).catch(() => {});
  throw error;
}

await run(process.execPath, [
  path.join(repoRoot, "scripts", "verify-video.mjs"),
  "--project",
  slug,
  "--file",
  output,
]);

const delivered = await copyWithoutOverwrite(output, readyDir, `${slug}.mp4`);
const manifest = {
  project: slug,
  localFile: output,
  deliveredFile: delivered,
  deliveredAt: new Date().toISOString(),
  metadata: "removed",
  workflow: "Move the file from ready to published after it is uploaded.",
};
await fs.writeFile(
  path.join(
    path.dirname(output),
    `${path.basename(output, path.extname(output))}.delivery.json`,
  ),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log("✓ Removed descriptive, authoring, location, and chapter metadata.");
console.log(`✓ iCloud ready: ${delivered}`);
console.log(`  After publishing, move it to: ${publishedDir}`);

async function resolveDeliveryRoot(configured) {
  const override = configured ?? process.env.YOUTUBE_SHORT_PIPELINE_ICLOUD_DIR;
  if (override) return path.resolve(expandHome(override));

  const cloudDocs = path.join(
    os.homedir(),
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
  );
  try {
    await fs.access(cloudDocs, fsConstants.W_OK);
  } catch {
    throw new Error(
      "iCloud Drive was not found. Enable iCloud Drive or pass --destination <folder>.",
    );
  }
  return path.join(cloudDocs, "YoutubeShortPipeline");
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function assertMetadataRemoved(file) {
  const probe = JSON.parse(
    await commandOutput("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags:stream_tags",
      "-of",
      "json",
      file,
    ]),
  );

  // MP4 requires a few structural identifiers. They contain no user, device, location, title, or
  // authoring information, so they are the only tags allowed to remain in the clean master.
  const allowedFormat = new Set(["major_brand", "minor_version", "compatible_brands"]);
  const allowedStream = new Set(["language", "handler_name", "vendor_id"]);
  const unexpected = [];

  for (const key of Object.keys(probe.format?.tags ?? {})) {
    if (!allowedFormat.has(key)) unexpected.push(`format:${key}`);
  }
  for (const [index, stream] of (probe.streams ?? []).entries()) {
    for (const key of Object.keys(stream.tags ?? {})) {
      if (!allowedStream.has(key)) unexpected.push(`stream${index}:${key}`);
    }
  }

  if (unexpected.length) {
    throw new Error(
      `Metadata removal check failed; unexpected tags remain: ${unexpected.join(", ")}`,
    );
  }
}

async function copyWithoutOverwrite(sourceFile, destinationDir, preferredName) {
  const extension = path.extname(preferredName);
  const stem = path.basename(preferredName, extension);
  let index = 1;

  while (true) {
    const name = index === 1 ? preferredName : `${stem}-${index}${extension}`;
    const destination = path.join(destinationDir, name);
    try {
      await fs.copyFile(sourceFile, destination, fsConstants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      index += 1;
    }
  }
}
