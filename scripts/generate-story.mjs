import fs from "node:fs/promises";
import path from "node:path";
import {
  loadEnv,
  parseArgs,
  readJson,
  repoRoot,
  resolveHyperframesVersion,
  run,
  sleep,
  videoDir,
  writeJson,
} from "./lib.mjs";
import {
  analyzeVoiceClip,
  assembleVoiceClips,
  ensureVoiceClipQuietTail,
  expectedAudiblePauseMs,
  expectedLastWord,
  normalizeVoiceClip,
  probeAudioDuration,
  transcribeVoiceClip,
  transcriptEndsWith,
} from "./narration-audio.mjs";
import { resolveVoiceboxEngine } from "./voicebox-profile.mjs";

await loadEnv();
const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const configPath = path.join(projectDir, "video.json");
const config = await readJson(configPath);
const hyperframesVersion = await resolveHyperframesVersion(config);
if (config.hyperframesVersion !== hyperframesVersion) {
  config.hyperframesVersion = hyperframesVersion;
  console.log(`Repaired missing HyperFrames version: ${hyperframesVersion}.`);
}
const voice = config.voicebox ?? {};

const baseUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
const scriptPath = flags.script
  ? path.resolve(flags.script)
  : path.join(projectDir, "content", "narration.txt");
const profileName = flags.profile ?? voice.profile ?? "MyOwn";
const requestedEngine = flags.engine ?? voice.engine ?? "qwen";
const modelSize = flags.model ?? voice.modelSize ?? "1.7B";
const language = flags.language ?? voice.language ?? "en";
const gapMs = Math.max(0, Math.round(Number(flags.gap ?? voice.gapMs ?? 3000)));
const finalHoldMs = Math.max(0, Math.round(Number(voice.finalHoldMs ?? gapMs)));
const transitionMs = Math.max(0, Math.round(Number(voice.transitionMs ?? 500)));
const minTailQuietMs = Math.max(0, Math.round(Number(voice.minTailQuietMs ?? 20)));
const qaTranscribe = flags["skip-voice-qa"] !== true && voice.qaTranscribe !== false;
const qaModel = String(flags["qa-model"] ?? voice.qaModel ?? "tiny.en");
const personality = flags.personality === true || voice.personality === true;
const storyName = flags.name ?? config.title ?? flags.project;
const storyDescription = flags.description ?? voice.storyDescription ?? null;

const manifestPath = path.join(projectDir, "content", "story.json");
const rawPath = path.join(projectDir, "public", "audio", "narration-raw.wav");
const finalPath = path.join(projectDir, "public", "audio", "narration.wav");
const timingPath = path.join(projectDir, "public", "audio", "narration.timing.json");
const lineDir = path.join(projectDir, "public", "audio", "lines");
const sourceLineDir = path.join(lineDir, "source");

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
  console.log(
    `\nWould build story "${storyName}" as ${profileName} / ${requestedEngine} ${modelSize}, ` +
      `${(gapMs / 1000).toFixed(2)}s requested minimum pause between audible lines.`,
  );
  process.exit(0);
}

if (flags.fit) {
  throw new Error(
    "--fit is disabled for paced stories because time-stretching would shorten the exact " +
      "silence between lines. Shorten the script or lower voicebox.gapMs instead.",
  );
}

async function api(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Voicebox-Client-Id": "youtube-pipeline",
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

const resolvedEngine = resolveVoiceboxEngine(profile, requestedEngine);
const engine = resolvedEngine.engine;
if (resolvedEngine.changed) {
  console.log(`Voice engine corrected: ${requestedEngine} → ${engine} (${resolvedEngine.reason}).`);
}
config.voicebox = {
  ...voice,
  profile: profile.name,
  engine,
  gapMs,
  finalHoldMs,
  transitionMs,
  minTailQuietMs,
  qaTranscribe,
  qaModel,
};
await writeJson(configPath, config);

// --resume picks up a run that stopped partway. It only continues a story whose finished
// lines still match the script, so a rewritten line always forces a clean rebuild.
let story = null;
let completed = [];

if (flags["story-id"]) {
  const existing = await api(`/stories/${flags["story-id"]}`).catch(() => null);
  if (!existing) {
    throw new Error(`Voicebox story "${flags["story-id"]}" was not found.`);
  }
  ({ story, completed } = adoptStory(existing));
  console.log(
    completed.length
      ? `Continuing "${story.name}" at line ${completed.length + 1} of ${lines.length}.`
      : `Using existing empty story "${story.name}" (${story.id}).`,
  );
}

if (flags.resume && !story) {
  const previous = await readJson(manifestPath).catch(() => null);
  const existing = previous?.storyId
    ? await api(`/stories/${previous.storyId}`).catch(() => null)
    : null;

  if (!existing) {
    console.log("No resumable story found. Building a new one.");
  } else {
    ({ story, completed } = adoptStory(existing));
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

// Persist the story before the first generation. If Voicebox rejects line one or the process
// stops, --resume can recover the empty story instead of creating an orphan.
await writeStoryManifest(story, completed);
await fs.mkdir(lineDir, { recursive: true });
await fs.mkdir(sourceLineDir, { recursive: true });

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

const accepted = [];

// A resumed story may contain manually re-rolled lines. Always export the active Voicebox
// version again and re-run the checks rather than trusting a stale local WAV.
for (const existing of completed) {
  const clip = await inspectExistingLine(existing);
  accepted.push(clip);
}

for (const [index, text] of lines.entries()) {
  if (index < accepted.length) continue;

  const clip = await generateAcceptedLine(text, index);
  const provisional = layoutClips([...accepted, clip]).at(-1);

  await api(`/stories/${story.id}/items`, {
    method: "POST",
    body: { generation_id: clip.generationId, start_time_ms: provisional.clipStartMs, track: 0 },
  });

  accepted.push(clip);
  await writeStoryManifest(story, layoutClips(accepted));
}

const placed = layoutClips(accepted);
await api(`/stories/${story.id}/items/times`, {
  method: "PUT",
  body: {
    updates: placed.map((line) => ({
      generation_id: line.generationId,
      start_time_ms: line.clipStartMs,
    })),
  },
});

const detail = await api(`/stories/${story.id}`);
const timedLines = buildTimingLines(placed);
const assembled = placed.map((line, index) => ({
  ...line,
  gapAfterMs:
    index === placed.length - 1
      ? 0
      : Math.max(0, placed[index + 1].clipStartMs - line.clipEndMs),
}));
await assembleVoiceClips(assembled, rawPath);
const rawDuration = await probeAudioDuration(rawPath);

// Each complete line was normalized before it was measured. Copying the assembled PCM master
// preserves those exact analyzed boundaries; normalizing after assembly would raise quiet word
// decay and make the promised pauses shorter than their timing metadata.
await fs.copyFile(rawPath, finalPath);
const finalDuration = await probeAudioDuration(finalPath);
const videoDuration = Number((finalDuration + finalHoldMs / 1000).toFixed(3));
const speechDuration = timedLines.reduce(
  (sum, line) => sum + (line.speechEnd - line.speechStart),
  0,
);

const timing = {
  story: { id: story.id, name: story.name, description: detail.description ?? null },
  audio: "audio/narration.wav",
  lineAudioDirectory: "audio/lines",
  profile: profile.name,
  engine,
  modelSize,
  gapMs,
  pauseMs: gapMs,
  finalHoldMs,
  transitionMs,
  minTailQuietMs,
  qaTranscribe,
  qaModel: qaTranscribe ? qaModel : null,
  tempo: 1,
  speechDuration: roundSeconds(speechDuration),
  narrationDuration: roundSeconds(finalDuration),
  spokenDuration: roundSeconds(finalDuration),
  videoDuration,
  lines: timedLines.map((line, index) => {
    const next = timedLines[index + 1];
    const pauseEnd = next ? next.speechStart : videoDuration;
    const imageStart =
      index === 0
        ? 0
        : Math.max(timedLines[index - 1].speechEnd, line.speechStart - transitionMs / 1000);
    const imageEnd = next ? next.speechStart : videoDuration;
    return {
      ...line,
      pauseStart: line.speechEnd,
      pauseEnd: roundSeconds(pauseEnd),
      imageStart: roundSeconds(imageStart),
      imageEnd: roundSeconds(imageEnd),
      transitionStart: roundSeconds(imageStart),
      transitionEnd: index === 0 ? 0 : line.speechStart,
    };
  }),
};

await writeJson(timingPath, timing);
config.duration = videoDuration;
await writeJson(configPath, config);
await writeStoryManifest(story, placed);
validateTimingPlan(timing, rawDuration);
await run(process.execPath, [
  path.join(repoRoot, "scripts", "validate-narration.mjs"),
  "--project",
  flags.project,
]);

console.log(
  `\nStory "${story.name}" has ${placed.length} verified lines, ` +
    `${(gapMs / 1000).toFixed(2)}s requested minimum pauses, and runs ` +
    `${finalDuration.toFixed(2)}s.`,
);
console.log(`Saved ${finalPath} (${finalDuration.toFixed(3)}s)`);
console.log(`Saved ${timingPath}`);
console.log("Every image hold can now animate through its narration and following silent pause.");
console.log("Open Voicebox to review or re-roll a line; --resume re-checks the active versions.");

async function inspectExistingLine(existing) {
  const file = linePath(existing.index);
  const sourceFile = sourceLinePath(existing.index);
  await exportGeneration(existing.generationId, sourceFile);
  await normalizeVoiceClip(sourceFile, file);
  let qa = await inspectLine(file, existing.text, existing.index, 0);

  // Manual Voicebox re-rolls deserve the same safe boundary repair as newly generated takes.
  // Once the final word is verified, appending silence preserves the take while preventing a
  // hard file boundary from clipping its decay during assembly.
  if (!qa.boundaryPassed && qa.lexicalPassed) {
    const repaired = await ensureVoiceClipQuietTail(file, {
      currentTrailingQuietMs: qa.analysis.trailingQuietMs,
      targetQuietMs: Math.max(minTailQuietMs, 60),
    });
    qa = {
      ...qa,
      passed: repaired.analysis.trailingQuietMs >= minTailQuietMs,
      reason: "",
      boundaryPassed: repaired.analysis.trailingQuietMs >= minTailQuietMs,
      tailPaddedMs: repaired.paddedMs,
      analysis: repaired.analysis,
    };
    console.warn(
      `Voicebox line ${existing.index + 1}'s final word was verified; appended ` +
        `${repaired.paddedMs}ms of safe tail without trimming speech.`,
    );
  }

  if (!qa.passed) {
    throw new Error(
      `Voicebox line ${existing.index + 1} did not pass after resume: ${qa.reason}. ` +
        "Re-roll that line in Voicebox and run with --resume again.",
    );
  }
  logAccepted(existing.index, existing.text, qa, true);
  return {
    index: existing.index,
    text: existing.text,
    generationId: existing.generationId,
    file,
    sourceFile,
    ...qa.analysis,
    qa,
  };
}

async function generateAcceptedLine(text, index) {
  const file = linePath(index);
  let lastQa = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const generation = await speak(text);
    const sourceFile = sourceLinePath(index);
    const sourceCandidate = path.join(
      sourceLineDir,
      `.${String(index + 1).padStart(2, "0")}-candidate.wav`,
    );
    const candidate = path.join(
      lineDir,
      `.${String(index + 1).padStart(2, "0")}-candidate.wav`,
    );
    await exportGeneration(generation.id, sourceCandidate);
    await normalizeVoiceClip(sourceCandidate, candidate);
    let qa = await inspectLine(candidate, text, index, attempt);
    lastQa = qa;

    // Keep the first re-roll as a chance for Voicebox to produce a naturally safer ending. If
    // the second take contains the verified final word but still ends too close to the boundary,
    // preserve every spoken sample and append a short quiet tail instead of failing the project.
    if (attempt === 2 && !qa.boundaryPassed && qa.lexicalPassed) {
      const repaired = await ensureVoiceClipQuietTail(candidate, {
        currentTrailingQuietMs: qa.analysis.trailingQuietMs,
        targetQuietMs: Math.max(minTailQuietMs, 60),
      });
      qa = {
        ...qa,
        passed: repaired.analysis.trailingQuietMs >= minTailQuietMs,
        reason: "",
        boundaryPassed: repaired.analysis.trailingQuietMs >= minTailQuietMs,
        tailPaddedMs: repaired.paddedMs,
        analysis: repaired.analysis,
      };
      lastQa = qa;
      console.warn(
        `Line ${index + 1}'s final word was verified; appended ` +
          `${repaired.paddedMs}ms of safe tail without trimming speech.`,
      );
    }

    if (qa.passed) {
      await fs.rm(file, { force: true });
      await fs.rename(candidate, file);
      await fs.rm(sourceFile, { force: true });
      await fs.rename(sourceCandidate, sourceFile);
      logAccepted(index, text, qa, false);
      return {
        index,
        text,
        generationId: generation.id,
        file,
        sourceFile,
        ...qa.analysis,
        qa,
      };
    }

    await fs.rm(candidate, { force: true });
    await fs.rm(sourceCandidate, { force: true });
    if (attempt === 1) {
      console.warn(`Line ${index + 1} sounded unsafe (${qa.reason}); re-generating once.`);
    }
  }

  throw new Error(
    `Voicebox line ${index + 1} failed twice: ${lastQa?.reason ?? "unknown quality failure"}. ` +
      "Review or re-roll that line in Voicebox before continuing.",
  );
}

async function exportGeneration(generationId, file) {
  const response = await fetch(`${baseUrl}/history/${generationId}/export-audio`, {
    headers: { "X-Voicebox-Client-Id": "youtube-pipeline" },
  });
  if (!response.ok) {
    throw new Error(`Voicebox audio export failed for ${generationId}: ${await response.text()}`);
  }
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function inspectLine(file, text, index, attempt) {
  const analysis = await analyzeVoiceClip(file);
  const boundaryPassed = analysis.trailingQuietMs >= minTailQuietMs;
  let lexicalPassed = true;
  let transcript = null;
  const expected = expectedLastWord(text);

  if (qaTranscribe) {
    try {
      transcript = await transcribeVoiceClip(file, {
        hyperframesVersion,
        model: qaModel,
        language,
      });
      lexicalPassed = transcriptEndsWith(transcript, expected);
    } catch (error) {
      throw new Error(
        `Could not verify Voicebox line ${index + 1}'s final word: ${error.message}. ` +
          "Install whisper-cpp or run with --skip-voice-qa only for a deliberate bypass.",
      );
    }
  }

  const reasons = [];
  if (!boundaryPassed) {
    reasons.push(
      `only ${analysis.trailingQuietMs.toFixed(1)}ms of quiet audio at the file boundary`,
    );
  }
  if (!lexicalPassed) {
    reasons.push(
      `expected final word "${expected}", transcription ended with "${transcript?.lastWord ?? "nothing"}"`,
    );
  }
  return {
    passed: boundaryPassed && lexicalPassed,
    reason: reasons.join("; "),
    boundaryPassed,
    lexicalPassed,
    expectedLastWord: expected,
    transcribedLastWord: transcript?.lastWord ?? null,
    transcript: transcript?.text ?? null,
    attempts: attempt,
    analysis,
  };
}

function layoutClips(clips) {
  const result = [];
  for (const [index, clip] of clips.entries()) {
    const previous = result.at(-1);
    const audiblePauseMs =
      index === 0
        ? 0
        : expectedAudiblePauseMs(
            gapMs,
            previous.trailingQuietMs,
            clip.leadingQuietMs,
          );
    const clipStartMs =
      index === 0
        ? 0
        : Math.round(previous.speechEndMs + audiblePauseMs - clip.leadingQuietMs);
    const clipEndMs = clipStartMs + clip.durationMs;
    const speechStartMs = clipStartMs + clip.leadingQuietMs;
    const speechEndMs = clipEndMs - clip.trailingQuietMs;
    result.push({
      ...clip,
      startMs: clipStartMs,
      clipStartMs,
      clipEndMs,
      speechStartMs,
      speechEndMs,
    });
  }
  return result;
}

function buildTimingLines(records) {
  return records.map((line) => ({
    index: line.index,
    text: line.text,
    generationId: line.generationId,
    audio: `audio/lines/${path.basename(line.file)}`,
    sourceAudio: line.sourceFile
      ? `audio/lines/source/${path.basename(line.sourceFile)}`
      : undefined,
    start: roundSeconds(line.clipStartMs / 1000),
    duration: roundSeconds(line.durationMs / 1000),
    end: roundSeconds(line.clipEndMs / 1000),
    clipStart: roundSeconds(line.clipStartMs / 1000),
    clipEnd: roundSeconds(line.clipEndMs / 1000),
    speechStart: roundSeconds(line.speechStartMs / 1000),
    speechEnd: roundSeconds(line.speechEndMs / 1000),
    leadingQuietMs: line.leadingQuietMs,
    trailingQuietMs: line.trailingQuietMs,
    boundaryPeakDb: line.boundaryPeakDb,
    qa: {
      passed: line.qa.passed,
      expectedLastWord: line.qa.expectedLastWord,
      transcribedLastWord: line.qa.transcribedLastWord,
      attempts: line.qa.attempts,
      tailPaddedMs: line.qa.tailPaddedMs ?? 0,
    },
  }));
}

function validateTimingPlan(timingData, assembledDuration) {
  const errors = [];
  const tolerance = 0.06;
  for (const [index, line] of timingData.lines.entries()) {
    if (!line.qa.passed) errors.push(`line ${index + 1} did not pass voice QA`);
    if (line.trailingQuietMs < minTailQuietMs) {
      errors.push(`line ${index + 1} has only ${line.trailingQuietMs}ms of quiet tail`);
    }
    const next = timingData.lines[index + 1];
    if (next) {
      const pause = next.speechStart - line.speechEnd;
      const expectedPause =
        expectedAudiblePauseMs(gapMs, line.trailingQuietMs, next.leadingQuietMs) / 1000;
      if (Math.abs(pause - expectedPause) > tolerance) {
        errors.push(
          `line ${index + 1} pause is ${pause.toFixed(3)}s; ` +
            `${expectedPause.toFixed(3)}s is required after preserving boundary quiet`,
        );
      }
      if (next.imageStart < line.speechEnd - tolerance) {
        errors.push(`image ${index + 2} begins before line ${index + 1} finishes`);
      }
    }
  }
  if (Math.abs(Number(timingData.narrationDuration) - assembledDuration) > tolerance) {
    errors.push("timing narrationDuration does not match the assembled WAV");
  }
  if (errors.length) throw new Error(`Narration validation failed: ${errors.join("; ")}.`);
}

function logAccepted(index, text, qa, resumed) {
  const label = resumed
    ? "checked"
    : qa.tailPaddedMs
      ? "accepted after safe-tail repair"
      : qa.attempts > 1
        ? "accepted after retry"
        : "accepted";
  console.log(
    `[${index + 1}/${lines.length}] ${label} · ` +
      `${(qa.analysis.durationMs / 1000).toFixed(2)}s · ` +
      `${qa.analysis.trailingQuietMs.toFixed(0)}ms safe tail · ${text.slice(0, 60)}`,
  );
}

function linePath(index) {
  return path.join(lineDir, `${String(index + 1).padStart(2, "0")}.wav`);
}

function sourceLinePath(index) {
  return path.join(sourceLineDir, `${String(index + 1).padStart(2, "0")}.wav`);
}

function roundSeconds(value) {
  return Number(Number(value).toFixed(3));
}

function adoptStory(existing) {
  // The story on the server is the truth. A manifest written just before a crash can lag the
  // timeline by one item, and replaying that item would duplicate it.
  const placed = [...(existing.items ?? [])].sort(
    (a, b) => a.start_time_ms - b.start_time_ms,
  );
  if (placed.length > lines.length) {
    throw new Error(
      `Voicebox story "${existing.name}" has ${placed.length} items, but the script has ` +
        `${lines.length} lines. Use a new empty story or rebuild it.`,
    );
  }
  const mismatchIndex = placed.findIndex((item, index) => item.text.trim() !== lines[index]);
  if (mismatchIndex >= 0) {
    throw new Error(
      `The script changed at line ${mismatchIndex + 1} since Voicebox story ` +
        `"${existing.name}" was built.\n` +
        `Script: ${JSON.stringify(lines[mismatchIndex])}\n` +
        `Voicebox: ${JSON.stringify(placed[mismatchIndex].text.trim())}\n` +
        "Rebuild the story after a narration edit, or restore the script text to resume it.",
    );
  }
  return {
    story: existing,
    completed: placed.map((item, index) => ({
      index,
      text: lines[index],
      generationId: item.generation_id,
      startMs: item.start_time_ms,
      durationMs: Math.round(item.duration * 1000),
    })),
  };
}

async function writeStoryManifest(targetStory, storyLines) {
  await writeJson(manifestPath, {
    storyId: targetStory.id,
    storyName: targetStory.name,
    profile: profile.name,
    engine,
    modelSize,
    language,
    gapMs,
    finalHoldMs,
    lines: storyLines.map((line) => ({
      index: line.index,
      text: line.text,
      generationId: line.generationId,
      startMs: Math.round(line.clipStartMs ?? line.startMs ?? 0),
      durationMs: Math.round(line.durationMs ?? 0),
      leadingQuietMs:
        line.leadingQuietMs === undefined ? undefined : Number(line.leadingQuietMs.toFixed(3)),
      trailingQuietMs:
        line.trailingQuietMs === undefined ? undefined : Number(line.trailingQuietMs.toFixed(3)),
      qa: line.qa
        ? {
            passed: Boolean(line.qa.passed),
            expectedLastWord: line.qa.expectedLastWord,
            transcribedLastWord: line.qa.transcribedLastWord,
            attempts: line.qa.attempts,
            tailPaddedMs: line.qa.tailPaddedMs ?? 0,
          }
        : undefined,
    })),
  });
}
