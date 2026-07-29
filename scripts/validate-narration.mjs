import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, readJson, videoDir } from "./lib.mjs";
import {
  analyzeVoiceClip,
  expectedAudiblePauseMs,
  measureWavPeakDb,
  probeAudioDuration,
} from "./narration-audio.mjs";

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const timingPath = path.join(projectDir, "public", "audio", "narration.timing.json");
const timing = await readJson(timingPath).catch(() => null);
if (!timing?.lines?.length) {
  throw new Error(
    `${timingPath} is missing or has no lines. Generate the Voicebox narration first.`,
  );
}

const narrationPath = path.join(projectDir, "public", timing.audio ?? "audio/narration.wav");
const narrationDuration = await probeAudioDuration(narrationPath);
const requestedPause = Number(timing.pauseMs ?? timing.gapMs ?? 0) / 1000;
const minTailQuietMs = Number(timing.minTailQuietMs ?? 20);
const errors = [];
const warnings = [];
const tolerance = 0.06;

if (Math.abs(narrationDuration - Number(timing.narrationDuration)) > tolerance) {
  errors.push(
    `narration.wav is ${narrationDuration.toFixed(3)}s but timing says ` +
      `${Number(timing.narrationDuration).toFixed(3)}s`,
  );
}

for (const [index, line] of timing.lines.entries()) {
  const label = `line ${index + 1}`;
  if (!line.qa?.passed) errors.push(`${label} has no passing final-word check`);
  if (!line.qa?.expectedLastWord) errors.push(`${label} has no expected final-word record`);
  if (timing.qaTranscribe && !line.qa?.transcribedLastWord) {
    errors.push(`${label} has no transcribed final-word record`);
  }

  const sourcePath = path.join(projectDir, "public", line.audio ?? "");
  const exists = await fs.access(sourcePath).then(() => true, () => false);
  if (!exists) {
    errors.push(`${label} source WAV is missing: ${path.relative(projectDir, sourcePath)}`);
  } else {
    const analysis = await analyzeVoiceClip(sourcePath);
    if (analysis.trailingQuietMs < minTailQuietMs) {
      errors.push(
        `${label} has ${analysis.trailingQuietMs.toFixed(1)}ms of quiet tail; ` +
          `${minTailQuietMs}ms is required`,
      );
    }
    if (Math.abs(analysis.durationMs / 1000 - Number(line.duration)) > tolerance) {
      errors.push(`${label} source duration does not match its timing record`);
    }
  }

  const next = timing.lines[index + 1];
  if (next) {
    const measuredPause = Number(next.speechStart) - Number(line.speechEnd);
    const expectedPause =
      expectedAudiblePauseMs(
        requestedPause * 1000,
        line.trailingQuietMs,
        next.leadingQuietMs,
      ) / 1000;
    if (Math.abs(measuredPause - expectedPause) > tolerance) {
      errors.push(
        `${label} has ${measuredPause.toFixed(3)}s before the next voice; ` +
          `${expectedPause.toFixed(3)}s is required after preserving boundary quiet`,
      );
    }
    if (Number(line.imageEnd) !== Number(next.speechStart)) {
      errors.push(`${label} image does not carry through to the next voice`);
    }
    if (
      Number(next.transitionStart) < Number(line.speechEnd) ||
      Number(next.transitionEnd) !== Number(next.speechStart)
    ) {
      errors.push(`image ${index + 2} transition is not contained inside the silent pause`);
    }

    // Sample the center of the promised pause in the finished, normalized narration. The
    // margins avoid classifying natural word decay as a failure while still checking several
    // seconds of the actual master file rather than trusting metadata alone.
    const checkStart = Number(line.speechEnd) + 0.2;
    const checkEnd = Number(next.speechStart) - 0.2;
    if (checkEnd > checkStart) {
      const peakDb = await measureWavPeakDb(narrationPath, checkStart, checkEnd);
      if (peakDb > -35) {
        errors.push(`${label} pause contains audio peaking at ${peakDb.toFixed(1)} dB`);
      }
    }
  }
}

const finalLine = timing.lines.at(-1);
if (Number(finalLine.clipEnd) > narrationDuration + tolerance) {
  errors.push("the final Voicebox clip extends past narration.wav");
}
if (Number(timing.videoDuration) < narrationDuration) {
  errors.push("the planned video ends before the narration");
}
if (Number(finalLine.imageEnd) !== Number(timing.videoDuration)) {
  errors.push("the final image does not carry through the ending hold");
}
if (Number(timing.finalHoldMs ?? 0) < 0) warnings.push("the final hold is negative");

if (errors.length) {
  throw new Error(`Narration validation failed:\n- ${errors.join("\n- ")}`);
}

console.log(
  `Narration validated: ${timing.lines.length} lines · ` +
    `${requestedPause.toFixed(2)}s requested minimum pause · ` +
    `${narrationDuration.toFixed(3)}s audio · ${Number(timing.videoDuration).toFixed(3)}s video.`,
);
for (const warning of warnings) console.warn(`Warning: ${warning}`);
