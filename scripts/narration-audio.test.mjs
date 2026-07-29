import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commandOutput } from "./lib.mjs";
import {
  analyzeVoiceClip,
  ensureVoiceClipQuietTail,
  expectedAudiblePauseMs,
  probeAudioDuration,
  transcriptEndsWith,
} from "./narration-audio.mjs";

test("quiet-tail repair preserves speech and appends enough silence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-audio-tail-"));
  const file = path.join(directory, "line.wav");
  try {
    await commandOutput("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.2",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      file,
    ]);
    const before = await analyzeVoiceClip(file);
    const durationBefore = await probeAudioDuration(file);
    assert.ok(before.trailingQuietMs < 20);

    const repaired = await ensureVoiceClipQuietTail(file, {
      currentTrailingQuietMs: before.trailingQuietMs,
      targetQuietMs: 60,
    });
    const durationAfter = await probeAudioDuration(file);
    assert.ok(repaired.paddedMs >= 60);
    assert.ok(repaired.analysis.trailingQuietMs >= 60);
    assert.ok(durationAfter > durationBefore);
    assert.ok(durationAfter - durationBefore < 0.1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("audible pause preserves natural boundary quiet when it exceeds the request", () => {
  assert.equal(expectedAudiblePauseMs(0, 66, 181), 247);
  assert.equal(expectedAudiblePauseMs(200, 66, 181), 247);
  assert.equal(expectedAudiblePauseMs(2000, 66, 181), 2000);
});

test("final-word check tolerates homophones Whisper spells differently", () => {
  assert.ok(transcriptEndsWith({ words: [{ text: "peace" }] }, "piece"));
  assert.ok(transcriptEndsWith({ words: [{ text: "knight" }] }, "night"));
  assert.ok(transcriptEndsWith({ words: [{ text: "piece" }] }, "piece"));
  assert.ok(!transcriptEndsWith({ words: [{ text: "xyzzy" }] }, "piece"));
});
