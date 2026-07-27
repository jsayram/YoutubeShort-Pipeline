import path from "node:path";
import { commandOutput, parseArgs, readJson, videoDir } from "./lib.mjs";

const { flags } = parseArgs();
const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const file = flags.file ?? path.join(projectDir, "renders", `${flags.project}.mp4`);
const probe = JSON.parse(
  await commandOutput("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type,width,height,r_frame_rate,sample_rate,channels",
    "-of",
    "json",
    file,
  ]),
);

const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");
const duration = Number(probe.format.duration);
const errors = [];

if (Math.abs(duration - config.duration) > 0.05) {
  errors.push(`Duration ${duration}s does not match ${config.duration}s.`);
}
if (video?.width !== config.width || video?.height !== config.height) {
  errors.push(`Resolution is ${video?.width}x${video?.height}, expected ${config.width}x${config.height}.`);
}
if (!audio) errors.push("No audio stream found.");

if (errors.length) throw new Error(errors.join(" "));
console.log(`✓ ${file}`);
console.log(`  ${duration.toFixed(3)}s · ${video.width}x${video.height} · ${video.r_frame_rate} · audio present`);

