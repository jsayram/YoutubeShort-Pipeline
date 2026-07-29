import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  readJson,
  resolveHyperframesVersion,
  run,
  sleep,
  videoDir,
  writeJson,
} from "./lib.mjs";
import {
  analyzeVoiceClip,
  ensureVoiceClipQuietTail,
  expectedLastWord,
  normalizeVoiceClip,
  transcribeVoiceClip,
  transcriptEndsWith,
} from "./narration-audio.mjs";
import {
  buildScenePrompts,
  loadPromptState,
  resolveProjectPromptProfile,
  saveScenePrompts,
} from "./prompt-profiles.mjs";
import { loadStyles } from "./image-styles.mjs";
import { resolveTopic } from "./topics.mjs";
import { resolveVoiceboxEngine } from "./voicebox-profile.mjs";

const CLIENT_HEADERS = { "X-Voicebox-Client-Id": "youtube-pipeline" };
const lineLocks = new Set();

export function reviewPath(projectDir) {
  return path.join(projectDir, "content", "narration-review.json");
}

export async function loadNarrationReview(slug) {
  return readJson(reviewPath(videoDir(slug))).catch(() => null);
}

// Studio keeps the pasted source separate from the editable narration working copy. Once a
// project exists, content/narration.txt wins on every rerun so review edits cannot be reset by
// the unchanged source text still visible in Studio.
export async function resolveStudioScriptInput(
  projectDir,
  submittedScript,
  { preferNarration = true } = {},
) {
  const sourcePath = path.join(projectDir, "content", "source-script.txt");
  const narrationPath = path.join(projectDir, "content", "narration.txt");
  const submitted = String(submittedScript ?? "").trim();
  if (!submitted) throw new Error("The original script is empty.");

  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  try {
    await fs.writeFile(sourcePath, `${submitted}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const narration = await fs.readFile(narrationPath, "utf8").catch(() => "");
  return {
    sourceScript: (await fs.readFile(sourcePath, "utf8")).trim(),
    narrationScript: preferNarration && narration.trim() ? narration.trim() : submitted,
    preservedNarration: Boolean(preferNarration && narration.trim()),
  };
}

export async function readStudioSourceScript(projectDir) {
  const source = await fs
    .readFile(path.join(projectDir, "content", "source-script.txt"), "utf8")
    .catch(() => "");
  if (source.trim()) return source.trim();
  const narration = await fs
    .readFile(path.join(projectDir, "content", "narration.txt"), "utf8")
    .catch(() => "");
  return narration.trim();
}

export async function saveReviewContinuation(slug, studioOptions) {
  const projectDir = videoDir(slug);
  const state = await requireState(slug);
  state.studioOptions = { ...studioOptions };
  state.updatedAt = new Date().toISOString();
  await saveState(projectDir, state);
  return state;
}

export function validateReview(state) {
  const errors = [];
  for (const line of state?.lines ?? []) {
    const selected = line.takes.find((take) => take.id === line.selectedTakeId);
    if (!selected) errors.push(`Line ${line.key} has no selected take.`);
    else if (selected.text !== line.text) {
      errors.push(`Line ${line.key}'s selected take speaks earlier wording.`);
    } else if (!selected.qa?.passed) {
      errors.push(`Line ${line.key}'s selected take did not pass automatic QA.`);
    }
  }
  if (!(state?.lines?.length > 0)) errors.push("There are no narration lines to approve.");
  return { valid: errors.length === 0, errors };
}

export async function prepareNarrationReview(
  slug,
  { autoApprove = false, forceRegenerate = false } = {},
) {
  const projectDir = videoDir(slug);
  const settings = await resolveSettings(projectDir);
  let state = await syncReviewState(projectDir, settings, { forceRegenerate });
  state.status = "generating";
  state.reviewEnabled = !autoApprove;
  await saveState(projectDir, state);

  for (const line of state.lines) {
    const selected = line.takes.find(
      (take) => take.id === line.selectedTakeId && take.text === line.text && take.qa?.passed,
    );
    if (selected) continue;

    const attempts = autoApprove ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await generateNarrationTake(slug, line.index);
      state = result.state;
      if (result.take.qa.passed) break;
    }
  }

  state = await loadNarrationReview(slug);
  state.status = autoApprove ? "ready-to-assemble" : "awaiting-review";
  state.updatedAt = new Date().toISOString();
  await saveState(projectDir, state);
  if (autoApprove) return approveNarrationReview(slug);
  return state;
}

export async function generateNarrationTake(slug, lineIndex) {
  const lockKey = `${slug}:${lineIndex}`;
  if (lineLocks.has(lockKey)) throw new Error(`Line ${lineIndex + 1} is already regenerating.`);
  lineLocks.add(lockKey);
  try {
    const projectDir = videoDir(slug);
    let state = await loadNarrationReview(slug);
    if (!state) {
      const settings = await resolveSettings(projectDir);
      state = await syncReviewState(projectDir, settings);
    }
    const line = state.lines.find((entry) => entry.index === lineIndex);
    if (!line) throw new Error(`Narration line ${lineIndex + 1} does not exist.`);

    const takeId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const candidateDir = path.join(
      projectDir,
      "public",
      "audio",
      "lines",
      "candidates",
      line.key,
    );
    await fs.mkdir(candidateDir, { recursive: true });
    const sourceFile = path.join(candidateDir, `${takeId}-source.wav`);
    const normalizedFile = path.join(candidateDir, `${takeId}.wav`);
    const take = {
      id: takeId,
      generationId: null,
      text: line.text,
      createdAt: new Date().toISOString(),
      sourceAudio: relativeProjectPath(projectDir, sourceFile),
      audio: relativeProjectPath(projectDir, normalizedFile),
      durationMs: null,
      qa: { passed: false, status: "generating", reason: "" },
    };
    line.takes.push(take);
    line.generating = true;
    state.status = "generating";
    await saveState(projectDir, state);

    try {
      const generation = await speak(state.settings, line.text);
      take.generationId = generation.id;
      await exportGeneration(state.settings.baseUrl, generation.id, sourceFile);
      await normalizeVoiceClip(sourceFile, normalizedFile);
      take.qa = await inspectCandidate(normalizedFile, line.text, state.settings);
      take.durationMs = take.qa.analysis.durationMs;
      if (take.qa.lexicalPassed && !take.qa.boundaryPassed) {
        const repaired = await ensureVoiceClipQuietTail(normalizedFile, {
          currentTrailingQuietMs: take.qa.analysis.trailingQuietMs,
          targetQuietMs: Math.max(state.settings.minTailQuietMs, 60),
        });
        take.qa = {
          ...take.qa,
          passed: repaired.analysis.trailingQuietMs >= state.settings.minTailQuietMs,
          boundaryPassed: repaired.analysis.trailingQuietMs >= state.settings.minTailQuietMs,
          reason: "",
          tailPaddedMs: repaired.paddedMs,
          analysis: repaired.analysis,
        };
        take.durationMs = repaired.analysis.durationMs;
      }
      take.qa.status = take.qa.passed ? "passed" : "failed";
      if (take.qa.passed && !line.selectedTakeId) line.selectedTakeId = take.id;
    } catch (error) {
      take.qa = { passed: false, status: "failed", reason: String(error.message ?? error) };
    } finally {
      line.generating = false;
      line.approvalValid = selectedTakeIsValid(line);
      state.status = "awaiting-review";
      state.updatedAt = new Date().toISOString();
      await saveState(projectDir, state);
    }
    return { state, take };
  } finally {
    lineLocks.delete(lockKey);
  }
}

export async function selectNarrationTake(slug, lineIndex, takeId) {
  const projectDir = videoDir(slug);
  const state = await requireState(slug);
  const line = requireLine(state, lineIndex);
  const take = line.takes.find((entry) => entry.id === takeId);
  if (!take) throw new Error(`Take "${takeId}" does not exist for line ${line.key}.`);
  if (take.text !== line.text) throw new Error("A take made for earlier wording cannot be selected.");
  if (!take.qa?.passed) throw new Error("Only a take that passed automatic QA can be selected.");
  line.selectedTakeId = take.id;
  line.approvalValid = true;
  state.status = "awaiting-review";
  state.updatedAt = new Date().toISOString();
  await saveState(projectDir, state);
  return state;
}

export async function editNarrationLine(slug, lineIndex, text) {
  const nextText = String(text ?? "").trim();
  if (!nextText) throw new Error("A narration line cannot be empty.");
  if (nextText.length > 600) throw new Error("A narration line cannot exceed 600 characters.");
  const projectDir = videoDir(slug);
  const state = await requireState(slug);
  const line = requireLine(state, lineIndex);
  if (line.text === nextText) return state;

  line.text = nextText;
  line.selectedTakeId = null;
  line.approvalValid = false;
  state.status = "awaiting-review";
  state.updatedAt = new Date().toISOString();

  const narrationPath = path.join(projectDir, "content", "narration.txt");
  await writeTextAtomic(narrationPath, `${state.lines.map((entry) => entry.text).join("\n")}\n`);
  await rebuildPromptForLine(projectDir, lineIndex);
  await fs.rm(path.join(projectDir, "content", "image-prompts.enriched.json"), { force: true });
  await writeJsonAtomic(path.join(projectDir, "content", "pipeline-stale.json"), {
    reason: "narration-edited",
    lineIndex,
    invalidatedAt: new Date().toISOString(),
    outputs: ["captions", "composition", "validation", "render"],
  });
  await saveState(projectDir, state);
  return state;
}

export async function approveNarrationReview(slug) {
  const projectDir = videoDir(slug);
  const state = await requireState(slug);
  const validation = validateReview(state);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  state.status = "assembling";
  await saveState(projectDir, state);

  const story = await voiceboxApi(state.settings.baseUrl, "/stories", {
    method: "POST",
    body: { name: state.settings.storyName, description: state.settings.storyDescription },
  });
  const selected = state.lines.map((line) => ({
    line,
    take: line.takes.find((take) => take.id === line.selectedTakeId),
  }));
  let previous = null;
  for (const { take } of selected) {
    const start = previous
      ? Math.max(
          previous.endMs,
          Math.round(
            previous.speechEndMs + state.settings.gapMs - take.qa.analysis.leadingQuietMs,
          ),
        )
      : 0;
    await voiceboxApi(state.settings.baseUrl, `/stories/${story.id}/items`, {
      method: "POST",
      body: { generation_id: take.generationId, start_time_ms: start, track: 0 },
    });
    previous = {
      endMs: start + take.durationMs,
      speechEndMs: start + take.durationMs - take.qa.analysis.trailingQuietMs,
    };
  }

  await writeJsonAtomic(path.join(projectDir, "content", "story.json"), {
    storyId: story.id,
    storyName: story.name,
    profile: state.settings.profile,
    engine: state.settings.engine,
    modelSize: state.settings.modelSize,
    language: state.settings.language,
    gapMs: state.settings.gapMs,
    finalHoldMs: state.settings.finalHoldMs,
    lines: selected.map(({ line, take }) => ({
      index: line.index,
      text: line.text,
      generationId: take.generationId,
      durationMs: take.durationMs,
      qa: take.qa,
    })),
  });
  await run(process.execPath, [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "generate-story.mjs"),
    "--project",
    slug,
    "--story-id",
    story.id,
    "--gap",
    String(state.settings.gapMs),
  ]);
  state.status = "approved";
  state.approvedAt = new Date().toISOString();
  state.updatedAt = state.approvedAt;
  for (const line of state.lines) line.approvalValid = selectedTakeIsValid(line);
  await fs.rm(path.join(projectDir, "content", "pipeline-stale.json"), { force: true });
  await saveState(projectDir, state);
  return state;
}

export function voiceSettingsChanged(previous, current) {
  if (!previous || !current) return false;
  return [
    "profileId",
    "profile",
    "engine",
    "modelSize",
    "language",
    "personality",
  ].some((field) => String(previous[field] ?? "") !== String(current[field] ?? ""));
}

async function syncReviewState(projectDir, settings, { forceRegenerate = false } = {}) {
  const narration = await fs.readFile(path.join(projectDir, "content", "narration.txt"), "utf8");
  const texts = narration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!texts.length) throw new Error("This project has no narration lines.");
  const existing = await readJson(reviewPath(projectDir)).catch(() => null);
  const invalidateAudio =
    forceRegenerate || voiceSettingsChanged(existing?.settings, settings);
  const lines = texts.map((text, index) => {
    const previous = existing?.lines?.find((line) => line.index === index);
    const line = {
      index,
      key: String(index + 1).padStart(2, "0"),
      text,
      takes: invalidateAudio ? [] : previous?.takes ?? [],
      selectedTakeId: invalidateAudio ? null : previous?.selectedTakeId ?? null,
      generating: false,
      approvalValid: false,
    };
    if (!selectedTakeIsValid(line)) line.selectedTakeId = null;
    line.approvalValid = selectedTakeIsValid(line);
    return line;
  });
  const state = {
    version: 1,
    status: existing?.status ?? "draft",
    reviewEnabled: existing?.reviewEnabled ?? true,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedAt: invalidateAudio ? null : existing?.approvedAt ?? null,
    settings,
    audioInvalidatedAt: invalidateAudio ? new Date().toISOString() : null,
    audioInvalidationReason: forceRegenerate
      ? "manual-regeneration"
      : invalidateAudio
        ? "voice-settings-changed"
        : null,
    lines,
  };
  await saveState(projectDir, state);
  return state;
}

async function resolveSettings(projectDir) {
  const configPath = path.join(projectDir, "video.json");
  const config = await readJson(configPath);
  const voice = config.voicebox ?? {};
  const baseUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
  const health = await fetch(`${baseUrl}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Voicebox is not reachable at ${baseUrl}.`);
  const profiles = await voiceboxApi(baseUrl, "/profiles");
  const requested = String(voice.profile ?? "MyOwn");
  const profile = profiles.find(
    (candidate) =>
      candidate.id === requested || candidate.name.toLowerCase() === requested.toLowerCase(),
  );
  if (!profile) throw new Error(`Voicebox profile "${requested}" was not found.`);
  const resolved = resolveVoiceboxEngine(profile, voice.engine ?? "qwen");
  const hyperframesVersion = await resolveHyperframesVersion(config);
  const settings = {
    baseUrl,
    profileId: profile.id,
    profile: profile.name,
    engine: resolved.engine,
    modelSize: String(voice.modelSize ?? "1.7B"),
    language: String(voice.language ?? "en"),
    personality: voice.personality === true,
    gapMs: Math.max(0, Math.round(Number(voice.gapMs ?? 3000))),
    finalHoldMs: Math.max(0, Math.round(Number(voice.finalHoldMs ?? voice.gapMs ?? 3000))),
    minTailQuietMs: Math.max(0, Math.round(Number(voice.minTailQuietMs ?? 20))),
    qaTranscribe: voice.qaTranscribe !== false,
    qaModel: String(voice.qaModel ?? "tiny.en"),
    hyperframesVersion,
    storyName: config.title ?? path.basename(projectDir),
    storyDescription: voice.storyDescription ?? null,
  };
  config.voicebox = { ...voice, profile: profile.name, engine: resolved.engine };
  await writeJson(configPath, config);
  return settings;
}

async function speak(settings, text) {
  let generation = await voiceboxApi(settings.baseUrl, "/generate", {
    method: "POST",
    body: {
      profile_id: settings.profileId,
      text,
      language: settings.language,
      engine: settings.engine,
      model_size: settings.modelSize,
      personality: settings.personality,
      normalize: true,
    },
  });
  const deadline = Date.now() + 20 * 60 * 1000;
  while (generation.status !== "completed") {
    if (generation.status === "failed") throw new Error(generation.error ?? "Voicebox failed.");
    if (Date.now() > deadline) throw new Error("Voicebox generation timed out after 20 minutes.");
    await sleep(1000);
    generation = await voiceboxApi(settings.baseUrl, `/history/${generation.id}`);
  }
  return generation;
}

async function inspectCandidate(file, text, settings) {
  const analysis = await analyzeVoiceClip(file);
  const boundaryPassed = analysis.trailingQuietMs >= settings.minTailQuietMs;
  let lexicalPassed = true;
  let transcript = null;
  const expected = expectedLastWord(text);
  if (settings.qaTranscribe) {
    transcript = await transcribeVoiceClip(file, {
      hyperframesVersion: settings.hyperframesVersion,
      model: settings.qaModel,
      language: settings.language,
    });
    lexicalPassed = transcriptEndsWith(transcript, expected);
  }
  const reasons = [];
  if (!boundaryPassed) reasons.push(`only ${analysis.trailingQuietMs.toFixed(1)}ms of quiet tail`);
  if (!lexicalPassed) {
    reasons.push(`expected "${expected}", heard "${transcript?.lastWord ?? "nothing"}"`);
  }
  return {
    passed: boundaryPassed && lexicalPassed,
    status: boundaryPassed && lexicalPassed ? "passed" : "failed",
    reason: reasons.join("; "),
    boundaryPassed,
    lexicalPassed,
    expectedLastWord: expected,
    transcribedLastWord: transcript?.lastWord ?? null,
    transcript: transcript?.text ?? null,
    tailPaddedMs: 0,
    analysis,
  };
}

async function exportGeneration(baseUrl, generationId, file) {
  const response = await fetch(`${baseUrl}/history/${generationId}/export-audio`, {
    headers: CLIENT_HEADERS,
  });
  if (!response.ok) throw new Error(`Voicebox audio export failed: ${await response.text()}`);
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function voiceboxApi(baseUrl, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...CLIENT_HEADERS },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new Error(`Voicebox ${options.method ?? "GET"} ${endpoint} failed: ${await response.text()}`);
  }
  return response.json();
}

async function rebuildPromptForLine(projectDir, lineIndex) {
  const config = await readJson(path.join(projectDir, "video.json"));
  const styles = await loadStyles();
  const style = styles.find((entry) => entry.id === config.imageGen?.style);
  const profileId = style?.promptProfile ?? config.imageGen?.style ?? "photographic";
  const { effective } = await resolveProjectPromptProfile({
    profileId,
    projectPath: projectDir,
  });
  const narration = await fs.readFile(path.join(projectDir, "content", "narration.txt"), "utf8");
  const lines = narration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const topic = await resolveTopic(config.topic);
  const generated = buildScenePrompts(lines, effective.sceneTemplate, topic);
  const existing = await readJson(path.join(projectDir, "content", "image-prompts.json")).catch(
    () => [],
  );
  const promptState = await loadPromptState(projectDir);
  const scenes = generated.map((scene, index) => (index === lineIndex ? scene : existing[index] ?? scene));
  const replacedId = existing[lineIndex]?.id;
  const editedSceneIds = (promptState.editedSceneIds ?? []).filter((id) => id !== replacedId);
  await saveScenePrompts({ profileId, projectPath: projectDir, scenes, editedSceneIds });
}

function requireLine(state, lineIndex) {
  const line = state.lines.find((entry) => entry.index === Number(lineIndex));
  if (!line) throw new Error(`Narration line ${Number(lineIndex) + 1} does not exist.`);
  return line;
}

async function requireState(slug) {
  const state = await loadNarrationReview(slug);
  if (!state) throw new Error("This project has no narration review yet.");
  return state;
}

function selectedTakeIsValid(line) {
  const selected = line.takes.find((take) => take.id === line.selectedTakeId);
  return Boolean(selected && selected.text === line.text && selected.qa?.passed);
}

function relativeProjectPath(projectDir, file) {
  return path.relative(projectDir, file).split(path.sep).join("/");
}

async function saveState(projectDir, state) {
  await writeJsonAtomic(reviewPath(projectDir), state);
}

async function writeTextAtomic(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, text);
  await fs.rename(temporary, filePath);
}

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
