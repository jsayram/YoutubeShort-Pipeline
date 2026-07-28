import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandOutput, resolveHyperframesVersion } from "./lib.mjs";

const DEFAULT_THRESHOLD_DB = -42;

export async function probeAudioDuration(filePath) {
  return Number(
    await commandOutput("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]),
  );
}

export async function normalizeVoiceClip(sourcePath, outputPath) {
  await commandOutput("ffmpeg", [
    "-y",
    "-i",
    sourcePath,
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ]);
}

// Voicebox sometimes exports a complete, transcribable phrase with almost no samples after the
// final phoneme. Preserve the entire normalized clip and append only the missing silence. This is
// used only after the final-word transcription has passed, so padding cannot conceal a missing or
// truncated word.
export async function ensureVoiceClipQuietTail(
  filePath,
  { currentTrailingQuietMs, targetQuietMs = 60 } = {},
) {
  const before =
    currentTrailingQuietMs === undefined
      ? await analyzeVoiceClip(filePath)
      : { trailingQuietMs: Number(currentTrailingQuietMs) };
  const missingMs = Math.max(0, Number(targetQuietMs) - before.trailingQuietMs);
  if (missingMs <= 0) {
    return { paddedMs: 0, analysis: await analyzeVoiceClip(filePath) };
  }

  // Five extra milliseconds absorb sample rounding and filter-boundary differences.
  const paddedMs = Math.ceil(missingMs + 5);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath, path.extname(filePath))}-tail-padded.wav`,
  );
  try {
    await commandOutput("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-af",
      `apad=pad_dur=${(paddedMs / 1000).toFixed(6)}`,
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      temporary,
    ]);
    const analysis = await analyzeVoiceClip(temporary);
    if (analysis.trailingQuietMs < targetQuietMs) {
      throw new Error(
        `Tail repair produced only ${analysis.trailingQuietMs.toFixed(1)}ms of quiet audio.`,
      );
    }
    await fs.rename(temporary, filePath);
    return { paddedMs, analysis };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// Voicebox currently exports mono PCM16 WAV files. Reading the samples directly lets the
// pipeline distinguish a complete phrase with a quiet tail from speech that reaches the final
// sample and may sound clipped. No samples are trimmed or rewritten here.
export async function analyzeVoiceClip(filePath, thresholdDb = DEFAULT_THRESHOLD_DB) {
  const buffer = await fs.readFile(filePath);
  const wav = parsePcm16Wav(buffer, filePath);
  const threshold = 32768 * 10 ** (thresholdDb / 20);
  const frameCount = Math.floor(wav.dataLength / 2 / wav.channels);

  let firstActive = -1;
  let lastActive = -1;
  let boundaryPeak = 0;
  const boundaryFrames = Math.max(1, Math.round(wav.sampleRate * 0.02));

  for (let frame = 0; frame < frameCount; frame += 1) {
    let active = false;
    for (let channel = 0; channel < wav.channels; channel += 1) {
      const offset = wav.dataOffset + (frame * wav.channels + channel) * 2;
      const sample = Math.abs(buffer.readInt16LE(offset));
      if (frame >= frameCount - boundaryFrames) boundaryPeak = Math.max(boundaryPeak, sample);
      if (sample > threshold) active = true;
    }
    if (active) {
      if (firstActive < 0) firstActive = frame;
      lastActive = frame;
    }
  }

  if (firstActive < 0 || lastActive < 0) {
    throw new Error(`${filePath} contains no audible speech above ${thresholdDb} dB.`);
  }

  const durationMs = (frameCount / wav.sampleRate) * 1000;
  const leadingQuietMs = (firstActive / wav.sampleRate) * 1000;
  const trailingQuietMs = ((frameCount - 1 - lastActive) / wav.sampleRate) * 1000;
  const boundaryPeakDb = 20 * Math.log10((boundaryPeak || 1) / 32768);

  return {
    durationMs: Math.round(durationMs),
    leadingQuietMs: roundMs(leadingQuietMs),
    trailingQuietMs: roundMs(trailingQuietMs),
    boundaryPeakDb: Number(boundaryPeakDb.toFixed(2)),
    thresholdDb,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
  };
}

export async function measureWavPeakDb(filePath, startSeconds, endSeconds) {
  const buffer = await fs.readFile(filePath);
  const wav = parsePcm16Wav(buffer, filePath);
  const frameCount = Math.floor(wav.dataLength / 2 / wav.channels);
  const startFrame = Math.max(0, Math.floor(Number(startSeconds) * wav.sampleRate));
  const endFrame = Math.min(frameCount, Math.ceil(Number(endSeconds) * wav.sampleRate));
  let peak = 0;

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    for (let channel = 0; channel < wav.channels; channel += 1) {
      const offset = wav.dataOffset + (frame * wav.channels + channel) * 2;
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(offset)));
    }
  }

  return Number((20 * Math.log10((peak || 1) / 32768)).toFixed(2));
}

export async function transcribeVoiceClip(filePath, options) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-short-voice-qa-"));
  const tempAudio = path.join(tempDir, "line.wav");

  try {
    await fs.copyFile(filePath, tempAudio);
    const version = await resolveHyperframesVersion({
      hyperframesVersion: options.hyperframesVersion,
    });
    const args = [
      "--yes",
      `hyperframes@${version}`,
      "transcribe",
      "line.wav",
      "--engine",
      options.engine ?? "whisper",
      "--model",
      options.model ?? "tiny.en",
      "--language",
      options.language ?? "en",
      "--json",
    ];
    await commandOutput("npx", args, { cwd: tempDir });
    const transcript = JSON.parse(await fs.readFile(path.join(tempDir, "transcript.json"), "utf8"));
    const words = collectTranscriptWords(transcript);
    if (!words.length) throw new Error("The speech check returned no words.");
    return {
      text: words.map((word) => word.text).join(" "),
      words,
      lastWord: normalizeWord(words.at(-1).text),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function expectedLastWord(text) {
  return String(text)
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)
    .at(-1);
}

export function transcriptEndsWith(transcript, expected) {
  const normalizedExpected = normalizeWord(expected);
  const words = transcript.words.map((word) => normalizeWord(word.text)).filter(Boolean);
  const candidates = [words.at(-1), `${words.at(-2) ?? ""}${words.at(-1) ?? ""}`].filter(Boolean);
  return candidates.some((candidate) => wordsApproximatelyMatch(candidate, normalizedExpected));
}

// Build the master narration from the accepted per-line Voicebox WAVs. Each gapAfterMs has
// already been corrected for the clips' own leading/trailing quiet, so the audible pause lands
// on the requested duration while every source sample remains intact.
export async function assembleVoiceClips(clips, outputPath) {
  if (!clips.length) throw new Error("No accepted Voicebox clips to assemble.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const args = ["-y"];
  for (const clip of clips) args.push("-i", clip.file);

  const filters = clips.map((clip, index) => {
    const gapSeconds = Math.max(0, Number(clip.gapAfterMs ?? 0)) / 1000;
    const clipSeconds = Number(clip.durationMs) / 1000;
    let chain = `[${index}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono`;
    if (gapSeconds > 0) {
      chain +=
        `,apad=pad_dur=${gapSeconds.toFixed(6)}` +
        `,atrim=duration=${(clipSeconds + gapSeconds).toFixed(6)}`;
    }
    return `${chain}[line${index}]`;
  });
  const inputs = clips.map((_, index) => `[line${index}]`).join("");
  filters.push(`${inputs}concat=n=${clips.length}:v=0:a=1[out]`);

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    outputPath,
  );
  await commandOutput("ffmpeg", args);
}

function parsePcm16Wav(buffer, filePath) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${filePath} is not a WAV file.`);
  }

  let cursor = 12;
  let format = null;
  let dataOffset = null;
  let dataLength = null;

  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString("ascii", cursor, cursor + 4);
    const length = buffer.readUInt32LE(cursor + 4);
    const offset = cursor + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(offset),
        channels: buffer.readUInt16LE(offset + 2),
        sampleRate: buffer.readUInt32LE(offset + 4),
        bitsPerSample: buffer.readUInt16LE(offset + 14),
      };
    } else if (id === "data") {
      dataOffset = offset;
      dataLength = Math.min(length, buffer.length - offset);
      break;
    }
    cursor = offset + length + (length % 2);
  }

  if (
    !format ||
    dataOffset === null ||
    dataLength === null ||
    format.audioFormat !== 1 ||
    format.bitsPerSample !== 16
  ) {
    throw new Error(`${filePath} must be an uncompressed 16-bit PCM WAV file.`);
  }

  return { ...format, dataOffset, dataLength };
}

function collectTranscriptWords(transcript) {
  const words = [];
  const push = (word) => {
    const text = String(word.text ?? word.word ?? "").trim();
    if (text) words.push({ text });
  };
  if (Array.isArray(transcript)) transcript.forEach(push);
  if (Array.isArray(transcript?.words)) transcript.words.forEach(push);
  for (const segment of transcript?.segments ?? transcript?.cues ?? []) {
    (segment.words ?? []).forEach(push);
  }
  return words;
}

function normalizeWord(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

function wordsApproximatelyMatch(actual, expected) {
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  const allowance = expected.length >= 8 ? 2 : expected.length >= 5 ? 1 : 0;
  return levenshtein(actual, expected) <= allowance;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous.at(-1);
}

function roundMs(value) {
  return Number(Number(value).toFixed(3));
}
