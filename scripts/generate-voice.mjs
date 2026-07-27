import fs from "node:fs/promises";
import path from "node:path";
import {
  commandOutput,
  loadEnv,
  parseArgs,
  readJson,
  run,
  sleep,
  videoDir,
} from "./lib.mjs";

await loadEnv();
const { flags } = parseArgs();
const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const narration = (await fs.readFile(path.join(projectDir, "content", "narration.txt"), "utf8")).trim();
const baseUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
const profile = flags.profile ?? config.voicebox.profile;
const engine = flags.engine ?? config.voicebox.engine;
const rawPath = path.join(projectDir, "public", "audio", "narration-raw.wav");
const finalPath = path.join(projectDir, "public", "audio", "narration.wav");

if (!narration) throw new Error("content/narration.txt is empty.");

const health = await fetch(`${baseUrl}/health`).catch(() => null);
if (!health?.ok) {
  throw new Error(
    `Voicebox is not reachable at ${baseUrl}. Start the Voicebox application and try again.`,
  );
}

const start = await fetch(`${baseUrl}/speak`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Voicebox-Client-Id": "youtube-short-pipeline",
  },
  body: JSON.stringify({
    text: narration,
    profile,
    engine,
    language: config.voicebox.language,
    personality: false,
  }),
});

if (!start.ok) throw new Error(`Voicebox generation failed to start: ${await start.text()}`);
const generation = await start.json();
const deadline = Date.now() + 20 * 60 * 1000;

while (Date.now() < deadline) {
  const response = await fetch(`${baseUrl}/history/${generation.id}`);
  if (!response.ok) throw new Error(`Voicebox status check failed: ${await response.text()}`);
  const status = await response.json();
  if (status.status === "failed") throw new Error(status.error ?? "Voicebox generation failed.");
  if (status.status === "completed") break;
  await sleep(1000);
}

if (Date.now() >= deadline) throw new Error("Voicebox generation timed out after 20 minutes.");

const audio = await fetch(`${baseUrl}/history/${generation.id}/export-audio`);
if (!audio.ok) throw new Error(`Voicebox audio export failed: ${await audio.text()}`);
await fs.mkdir(path.dirname(rawPath), { recursive: true });
await fs.writeFile(rawPath, Buffer.from(await audio.arrayBuffer()));

const rawDuration = Number(
  await commandOutput("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    rawPath,
  ]),
);
const target = Number(config.duration);
const tempo = rawDuration > target ? rawDuration / target : 1;
if (tempo > 1.25) {
  throw new Error(
    `Narration is ${rawDuration.toFixed(1)}s. Shorten the script instead of speeding it up by ${tempo.toFixed(2)}x.`,
  );
}

const filters = [];
if (tempo > 1.001) filters.push(`atempo=${tempo.toFixed(6)}`);
filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
filters.push(`apad=pad_dur=${target}`);
await run("ffmpeg", [
  "-y",
  "-i",
  rawPath,
  "-af",
  filters.join(","),
  "-ar",
  "48000",
  "-t",
  String(target),
  finalPath,
]);

const finalDuration = await commandOutput("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration",
  "-of",
  "default=noprint_wrappers=1:nokey=1",
  finalPath,
]);
console.log(`Saved ${finalPath} (${Number(finalDuration).toFixed(3)}s)`);

