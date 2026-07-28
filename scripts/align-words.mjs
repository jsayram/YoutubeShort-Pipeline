import fs from "node:fs/promises";
import path from "node:path";
import { commandOutput, parseArgs, readJson, run, videoDir, writeJson } from "./lib.mjs";

// Word-level timings for the narration Voicebox already produced.
//
// Voicebox gives one timing per spoken line, which is right for scene boundaries and useless for
// one-word-at-a-time captions. Rather than adding a second ASR stack, this wraps the transcriber
// HyperFrames already ships: it writes transcript.json in the project, which is exactly the file
// a composition reads for word timing.
//
// The narration is transcribed as complete sentences and aligned afterwards. Generating words
// separately in Voicebox would destroy the phrasing and the natural pauses.

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const slug = flags.project;
const projectDir = videoDir(slug);
const config = await readJson(path.join(projectDir, "video.json"));
const audioPath = path.join(projectDir, "public", "audio", "narration.wav");

if (!(await fs.access(audioPath).then(() => true, () => false))) {
  throw new Error(
    `${path.relative(projectDir, audioPath)} is missing. Build the voice first: ` +
      `npm run story -- --project ${slug}`,
  );
}

// Fail with the fix rather than a stack trace from inside the CLI.
const engine = flags.engine ?? (await detectEngine());
if (!engine) {
  throw new Error(
    "No speech-alignment engine is installed. Pick one:\n" +
      "  uv pip install parakeet-mlx      (faster and more accurate on Apple Silicon)\n" +
      "  brew install whisper-cpp         (portable fallback)\n" +
      "Then re-run this command.",
  );
}

const args = [
  "--yes",
  `hyperframes@${config.hyperframesVersion}`,
  "transcribe",
  path.relative(projectDir, audioPath),
  "--engine",
  engine,
  "--language",
  config.voicebox?.language ?? "en",
];
if (flags.model) args.push("--model", flags.model);

console.log(`Aligning ${path.basename(audioPath)} with ${engine}…`);
await run("npx", args, { cwd: projectDir });

// The transcriber writes its sidecar next to the audio it was given, not at the project root.
// Check both so this keeps working if that changes.
const candidates = [
  path.join(path.dirname(audioPath), "transcript.json"),
  path.join(projectDir, "transcript.json"),
];
let transcript = null;
let transcriptPath = null;
for (const candidate of candidates) {
  transcript = await readJson(candidate).catch(() => null);
  if (transcript) {
    transcriptPath = candidate;
    break;
  }
}
if (!transcript) {
  throw new Error(
    `No transcript found. Looked in: ${candidates.map((c) => path.relative(projectDir, c)).join(", ")}`,
  );
}
console.log(`Read ${path.relative(projectDir, transcriptPath)}`);

// Normalise to a flat word list next to the line timings, so a composition can drive captions
// without knowing which transcriber produced them.
const words = collectWords(transcript);
if (!words.length) throw new Error("The transcript contains no word-level timings.");

const timingPath = path.join(projectDir, "public", "audio", "narration.timing.json");
const timing = await readJson(timingPath).catch(() => ({}));
timing.words = words;
await writeJson(timingPath, timing);

const spoken = Number(timing.spokenDuration ?? words.at(-1).end);
console.log(`${words.length} words aligned across ${spoken.toFixed(2)}s.`);
console.log(`Updated ${path.relative(projectDir, timingPath)}`);
console.log(
  `First words: ${words
    .slice(0, 6)
    .map((word) => `${word.text}@${word.start.toFixed(2)}`)
    .join(" ")}`,
);

async function detectEngine() {
  const parakeet = await commandOutput("python3", ["-c", "import parakeet_mlx"]).then(
    () => true,
    () => false,
  );
  if (parakeet) return "parakeet";
  for (const binary of ["whisper-cli", "whisper-cpp", "whisper"]) {
    const found = await commandOutput("which", [binary]).then(
      () => true,
      () => false,
    );
    if (found) return "whisper";
  }
  return null;
}

// Transcript shapes differ between engines and versions, so accept the common ones rather than
// assuming a single layout.
function collectWords(transcript) {
  const out = [];
  const push = (word) => {
    const text = String(word.text ?? word.word ?? "").trim();
    const start = Number(word.start ?? word.startTime);
    const end = Number(word.end ?? word.endTime);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return;
    out.push({ text, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
  };

  // HyperFrames writes a bare array of {text,start,end}. Other engines nest words under
  // segments or under a words key, so all three are accepted.
  if (Array.isArray(transcript)) transcript.forEach(push);
  if (Array.isArray(transcript.words)) transcript.words.forEach(push);
  for (const segment of transcript.segments ?? transcript.cues ?? []) {
    (segment.words ?? []).forEach(push);
  }
  return out.sort((a, b) => a.start - b.start);
}
