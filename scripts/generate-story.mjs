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
  writeJson,
} from "./lib.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const config = await readJson(path.join(projectDir, "video.json"));
const voice = config.voicebox ?? {};

const baseUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
const scriptPath = flags.script
  ? path.resolve(flags.script)
  : path.join(projectDir, "content", "narration.txt");
const profileName = flags.profile ?? voice.profile ?? "MyOwn";
const engine = flags.engine ?? voice.engine ?? "qwen";
const modelSize = flags.model ?? voice.modelSize ?? "1.7B";
const language = flags.language ?? voice.language ?? "en";
const gapMs = Math.max(0, Math.round(Number(flags.gap ?? voice.gapMs ?? 200)));
const personality = flags.personality === true || voice.personality === true;
const storyName = flags.name ?? config.title ?? flags.project;
const storyDescription = flags.description ?? voice.storyDescription ?? null;

const manifestPath = path.join(projectDir, "content", "story.json");
const rawPath = path.join(projectDir, "public", "audio", "narration-raw.wav");
const finalPath = path.join(projectDir, "public", "audio", "narration.wav");
const timingPath = path.join(projectDir, "public", "audio", "narration.timing.json");

// One spoken line per non-empty line of the script. Voicebox reads each one as its own
// generation, which keeps the phrasing tight and gives every line its own timeline item.
const lines = (await fs.readFile(scriptPath, "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (!lines.length) throw new Error(`${scriptPath} has no spoken lines.`);
for (const [index, line] of lines.entries()) {
  if (line.length > 600) {
    console.warn(
      `Line ${index + 1} is ${line.length} characters. Voicebox will chunk it internally; ` +
        "split it across lines for tighter control.",
    );
  }
}

if (flags["dry-run"]) {
  console.log(`${lines.length} lines from ${path.relative(projectDir, scriptPath)}:\n`);
  for (const [index, line] of lines.entries()) {
    console.log(`${String(index + 1).padStart(2)}. (${line.split(/\s+/).length}w) ${line}`);
  }
  console.log(`\nWould build story "${storyName}" as ${profileName} / ${engine} ${modelSize}.`);
  process.exit(0);
}

async function api(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Voicebox-Client-Id": "youtube-short-pipeline",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new Error(`Voicebox ${options.method ?? "GET"} ${endpoint} failed: ${await response.text()}`);
  }
  return response.json();
}

const health = await fetch(`${baseUrl}/health`).catch(() => null);
if (!health?.ok) {
  throw new Error(
    `Voicebox is not reachable at ${baseUrl}. Start the Voicebox application and try again.`,
  );
}

const profiles = await api("/profiles");
const profile = profiles.find(
  (candidate) =>
    candidate.id === profileName || candidate.name.toLowerCase() === profileName.toLowerCase(),
);
if (!profile) {
  throw new Error(
    `Voicebox profile "${profileName}" not found. Available: ${profiles.map((p) => p.name).join(", ")}`,
  );
}

// --resume picks up a run that stopped partway. It only continues a story whose finished
// lines still match the script, so a rewritten line always forces a clean rebuild.
let story = null;
let completed = [];

if (flags.resume) {
  const previous = await readJson(manifestPath).catch(() => null);
  const existing = previous?.storyId
    ? await api(`/stories/${previous.storyId}`).catch(() => null)
    : null;

  if (!existing) {
    console.log("No resumable story found. Building a new one.");
  } else {
    // The story on the server is the truth. A manifest written just before a crash can
    // lag the timeline by one item, and replaying that item would duplicate it.
    const placed = [...existing.items].sort((a, b) => a.start_time_ms - b.start_time_ms);
    if (placed.length > lines.length || placed.some((item, i) => item.text.trim() !== lines[i])) {
      throw new Error(
        "The script changed since that story was built. Re-run without --resume to rebuild it.",
      );
    }
    story = existing;
    completed = placed.map((item, index) => ({
      index,
      text: lines[index],
      generationId: item.generation_id,
      startMs: item.start_time_ms,
      durationMs: Math.round(item.duration * 1000),
    }));
    console.log(
      completed.length === lines.length
        ? `"${story.name}" already has all ${lines.length} lines. Re-exporting audio and timings.`
        : `Resuming "${story.name}" at line ${completed.length + 1} of ${lines.length}.`,
    );
  }
}

if (!story) {
  story = await api("/stories", {
    method: "POST",
    body: { name: storyName, description: storyDescription },
  });
  console.log(`Created story "${story.name}" (${story.id}).`);
}

let cursorMs = completed.length
  ? completed.at(-1).startMs + completed.at(-1).durationMs + gapMs
  : 0;

async function speak(text) {
  let generation = await api("/generate", {
    method: "POST",
    body: {
      profile_id: profile.id,
      text,
      language,
      engine,
      model_size: modelSize,
      personality,
      normalize: true,
    },
  });

  const deadline = Date.now() + 20 * 60 * 1000;
  while (generation.status !== "completed") {
    if (generation.status === "failed") {
      throw new Error(generation.error ?? `Voicebox failed to speak: ${text.slice(0, 60)}`);
    }
    if (Date.now() > deadline) throw new Error("Voicebox generation timed out after 20 minutes.");
    await sleep(1000);
    generation = await api(`/history/${generation.id}`);
  }
  return generation;
}

for (const [index, text] of lines.entries()) {
  if (index < completed.length) continue;

  const generation = await speak(text);
  const durationMs = Math.round(Number(generation.duration ?? 0) * 1000);
  if (!durationMs) throw new Error(`Voicebox returned no audio for line ${index + 1}.`);

  await api(`/stories/${story.id}/items`, {
    method: "POST",
    body: { generation_id: generation.id, start_time_ms: cursorMs, track: 0 },
  });

  completed.push({
    index,
    text,
    generationId: generation.id,
    startMs: cursorMs,
    durationMs,
  });
  await writeJson(manifestPath, {
    storyId: story.id,
    storyName: story.name,
    profile: profile.name,
    engine,
    modelSize,
    language,
    gapMs,
    lines: completed,
  });

  const seconds = (cursorMs / 1000).toFixed(1);
  console.log(
    `[${index + 1}/${lines.length}] ${seconds}s +${(durationMs / 1000).toFixed(2)}s  ${text.slice(0, 60)}`,
  );
  cursorMs += durationMs + gapMs;
}

// The server owns the final placement, so read the timings back rather than trusting the cursor.
const detail = await api(`/stories/${story.id}`);
const placed = [...detail.items].sort((a, b) => a.start_time_ms - b.start_time_ms);

const audio = await fetch(`${baseUrl}/stories/${story.id}/export-audio`);
if (!audio.ok) throw new Error(`Voicebox story export failed: ${await audio.text()}`);
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
let tempo = 1;
if (flags.fit && rawDuration > target) {
  tempo = rawDuration / target;
  if (tempo > 1.25) {
    throw new Error(
      `Narration is ${rawDuration.toFixed(1)}s against a ${target}s video. Shorten the script instead of speeding it up by ${tempo.toFixed(2)}x.`,
    );
  }
}

const spokenDuration = rawDuration / tempo;
const filters = [];
if (tempo > 1.001) filters.push(`atempo=${tempo.toFixed(6)}`);
filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

const ffmpegArgs = ["-y", "-i", rawPath];
if (spokenDuration <= target + 0.001) {
  filters.push(`apad=pad_dur=${target}`);
  ffmpegArgs.push("-af", filters.join(","), "-ar", "48000", "-t", String(target), finalPath);
} else {
  ffmpegArgs.push("-af", filters.join(","), "-ar", "48000", finalPath);
}
await run("ffmpeg", ffmpegArgs);

await writeJson(timingPath, {
  story: { id: story.id, name: story.name, description: detail.description ?? null },
  audio: "audio/narration.wav",
  profile: profile.name,
  engine,
  modelSize,
  gapMs,
  tempo: Number(tempo.toFixed(6)),
  spokenDuration: Number(spokenDuration.toFixed(3)),
  videoDuration: target,
  lines: placed.map((item, index) => {
    const start = item.start_time_ms / 1000 / tempo;
    const duration = item.duration / tempo;
    return {
      index,
      text: item.text.trim(),
      start: Number(start.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      end: Number((start + duration).toFixed(3)),
    };
  }),
});

const finalDuration = Number(
  await commandOutput("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    finalPath,
  ]),
);

console.log(`\nStory "${story.name}" has ${placed.length} lines and runs ${spokenDuration.toFixed(2)}s.`);
console.log(`Saved ${finalPath} (${finalDuration.toFixed(3)}s)`);
console.log(`Saved ${timingPath}`);
console.log("Open Voicebox to review, re-roll a line, or export the story yourself.");

if (spokenDuration > target + 0.001) {
  console.warn(
    `\nNarration runs ${spokenDuration.toFixed(1)}s but video.json asks for ${target}s. ` +
      "Shorten the script, raise duration, or re-run with --fit.",
  );
}
