import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  commandOutput,
  parseArgs,
  readJson,
  resolveHyperframesVersion,
  run,
  videoDir,
  writeJson,
} from "./lib.mjs";
import {
  assertAlignedLine,
  collectTranscriptWords,
  fitWordsToLine,
} from "./word-alignment.mjs";

// Word-level timings for the narration Voicebox already produced.
//
// Voicebox gives one timing per spoken line, which is right for scene boundaries and insufficient
// for one-word-at-a-time captions. Rather than adding a second ASR stack, this wraps the
// transcriber HyperFrames already ships.
//
// Do not transcribe the assembled narration as one file. Parakeet and Whisper can remove long
// silence from their timestamp clock, which made every later line appear progressively early.
// Transcribe each already-generated line, fit its internal word rhythm to the measured speech
// window, then restore its exact position in the assembled narration.

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

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
const audioPath = path.join(projectDir, "public", "audio", "narration.wav");
const timingPath = path.join(projectDir, "public", "audio", "narration.timing.json");
const timing = await readJson(timingPath).catch(() => null);

if (!(await fs.access(audioPath).then(() => true, () => false))) {
  throw new Error(
    `${path.relative(projectDir, audioPath)} is missing. Build the voice first: ` +
      `npm run story -- --project ${slug}`,
  );
}
if (!Array.isArray(timing?.lines) || !timing.lines.length) {
  throw new Error(
    "narration.timing.json has no Voicebox line timings. Rebuild the narration before captions.",
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

const language = config.voicebox?.language ?? "en";
const model = flags.model ?? (language === "en" ? "small.en" : "small");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-short-caption-align-"));
const words = [];

console.log(`Aligning ${timing.lines.length} Voicebox line(s) with ${engine}…`);
try {
  for (const [index, line] of timing.lines.entries()) {
    const sourcePath = path.join(projectDir, "public", String(line.audio ?? ""));
    if (!(await fs.access(sourcePath).then(() => true, () => false))) {
      throw new Error(
        `Missing line audio for caption alignment: ${path.relative(projectDir, sourcePath)}`,
      );
    }

    const lineDir = path.join(temporaryRoot, String(index + 1).padStart(2, "0"));
    await fs.mkdir(lineDir, { recursive: true });
    const inputName = `line${path.extname(sourcePath) || ".wav"}`;
    await fs.copyFile(sourcePath, path.join(lineDir, inputName));
    const args = [
      "--yes",
      `hyperframes@${hyperframesVersion}`,
      "transcribe",
      inputName,
      "--engine",
      engine,
      "--model",
      model,
      "--language",
      language,
      "--json",
    ];
    await run("npx", args, { cwd: lineDir });

    const transcriptPath = path.join(lineDir, "transcript.json");
    const transcript = await readJson(transcriptPath).catch(() => null);
    if (!transcript) {
      throw new Error(`The speech aligner produced no transcript for line ${index + 1}.`);
    }
    const relativeWords = collectTranscriptWords(transcript);
    const fitted = fitWordsToLine(relativeWords, line, index);
    assertAlignedLine(fitted, line, index);
    words.push(...fitted);
    console.log(
      `[${index + 1}/${timing.lines.length}] ${fitted.length} words · ` +
        `${fitted[0].start.toFixed(2)}s–${fitted.at(-1).end.toFixed(2)}s`,
    );
  }
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

if (!words.length) throw new Error("The transcripts contain no word-level timings.");

// Keep one consolidated sidecar for inspection and for tools that consume the standard
// HyperFrames transcript shape.
const transcriptPath = path.join(projectDir, "public", "audio", "transcript.json");
await writeJson(transcriptPath, words);
timing.words = words;
timing.wordAlignment = {
  strategy: "per-line-speech-window",
  engine,
  model,
  language,
  lineCount: timing.lines.length,
};
await writeJson(timingPath, timing);

const narrationDuration = Number(timing.narrationDuration ?? words.at(-1).end);
console.log(`${words.length} words aligned across ${narrationDuration.toFixed(2)}s.`);
console.log(`Updated ${path.relative(projectDir, timingPath)}`);
console.log(`Updated ${path.relative(projectDir, transcriptPath)}`);
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
