import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  readJson,
  repoRoot,
  run,
  videoDir,
} from "./lib.mjs";

const sceneLocks = new Set();

export function imageReviewPath(projectDir) {
  return path.join(projectDir, "content", "image-review.json");
}

export async function loadImageReview(slug) {
  return readJson(imageReviewPath(videoDir(slug))).catch(() => null);
}

async function saveState(projectDir, state) {
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(imageReviewPath(projectDir), state);
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, filePath);
}

function projectRelative(projectDir, filePath) {
  return path.relative(projectDir, filePath).split(path.sep).join("/");
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function providerUsage(provider, scene, audit) {
  const local = provider === "comfyui" || provider === "flux2-local" || provider === "local";
  if (local) {
    return {
      kind: "local",
      requests: 0,
      creditsUsed: 0,
      estimatedCost: 0,
      quotaRemaining: null,
      note: "Local generation · no cloud credits used",
    };
  }

  const reported =
    scene?.providerResponse?.usageMetadata ??
    scene?.providerResponse?.usage ??
    scene?.providerResponse?.usage_metadata ??
    null;
  const creditsUsed =
    reported?.creditsUsed ??
    reported?.credits_used ??
    reported?.credits ??
    null;
  const quotaRemaining =
    reported?.quotaRemaining ??
    reported?.quota_remaining ??
    audit?.usage?.quotaRemaining ??
    null;
  return {
    kind: "cloud",
    requests: scene?.status === "reused" ? 0 : 1,
    creditsUsed:
      provider === "pixazo-sdxl"
        ? 0
        : creditsUsed != null && Number.isFinite(Number(creditsUsed))
          ? Number(creditsUsed)
          : null,
    estimatedCost: provider === "pixazo-sdxl" ? 0 : null,
    quotaRemaining:
      quotaRemaining != null && Number.isFinite(Number(quotaRemaining))
        ? Number(quotaRemaining)
        : null,
    reported,
    note:
      provider === "pixazo-sdxl"
        ? "Free-preview request · remaining quota not reported by Pixazo"
        : "Cloud request · credit cost and remaining quota not reported by provider",
  };
}

function summarizeUsage(lines, audit) {
  const takes = lines.flatMap((line) => line.takes);
  const takeRequests = takes.reduce((sum, take) => sum + Number(take.usage?.requests ?? 0), 0);
  const requests = Math.max(takeRequests, Number(audit?.usage?.requests ?? 0));
  const knownCredits = takes.filter((take) => take.usage?.creditsUsed != null);
  const creditsUsed = audit?.usage?.creditsUsed != null
    ? Number(audit.usage.creditsUsed)
    : knownCredits.length
    ? knownCredits.reduce((sum, take) => sum + Number(take.usage.creditsUsed), 0)
    : null;
  const knownCost = takes.filter((take) => take.usage?.estimatedCost != null);
  const estimatedCost = audit?.usage?.estimatedCost != null
    ? Number(audit.usage.estimatedCost)
    : knownCost.length
    ? knownCost.reduce((sum, take) => sum + Number(take.usage.estimatedCost), 0)
    : null;
  return {
    provider: audit?.provider ?? takes.at(-1)?.provider ?? null,
    requests,
    creditsUsed,
    estimatedCost,
    quotaRemaining: audit?.usage?.quotaRemaining ?? null,
    quotaNote:
      audit?.usage?.quotaNote ??
      (takes.some((take) => take.usage?.kind === "cloud")
        ? "The provider did not expose an account credit balance or remaining generation quota."
        : "Local generation does not consume cloud credits."),
  };
}

async function latestAudit(projectDir) {
  return readJson(
    path.join(projectDir, "public", "generated", "audit", "latest.json"),
  ).catch(() => null);
}

function sceneFromAudit(audit, id) {
  return audit?.scenes?.find((scene) => scene.id === id) ?? null;
}

async function archiveCurrentImage(projectDir, entry, scene, audit) {
  const source = path.join(projectDir, entry.file);
  const extension = path.extname(source) || ".png";
  const takeId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const candidateDir = path.join(
    projectDir,
    "public",
    "generated",
    "candidates",
    entry.id,
  );
  await fs.mkdir(candidateDir, { recursive: true });
  const candidate = path.join(candidateDir, `${takeId}${extension}`);
  await fs.copyFile(source, candidate);
  return {
    id: takeId,
    createdAt: new Date().toISOString(),
    image: projectRelative(projectDir, candidate),
    sha256: await sha256(candidate),
    prompt: scene?.overlayPrompt ?? entry.scenePrompt ?? entry.prompt,
    finalPrompt: scene?.finalPrompt ?? entry.prompt ?? null,
    negativePrompt: scene?.negativePrompt ?? entry.negativePrompt ?? null,
    provider: audit?.provider ?? entry.provider ?? null,
    model:
      entry.model ??
      entry.checkpoint ??
      entry.diffusionModel ??
      audit?.configuration?.model ??
      audit?.configuration?.diffusionModel ??
      null,
    seed: scene?.seed ?? entry.seed ?? null,
    settings: scene?.settings ?? null,
    references: scene?.references ?? entry.references ?? [],
    auditRunId: audit?.runId ?? null,
    usage: providerUsage(audit?.provider ?? entry.provider, scene, audit),
  };
}

export function validateImageReview(state) {
  const errors = [];
  for (const line of state?.lines ?? []) {
    if (line.generating) {
      errors.push(`Image ${line.key} is still generating.`);
      continue;
    }
    const selected = line.takes.find((take) => take.id === line.selectedTakeId);
    if (!selected) errors.push(`Image ${line.key} has no selected take.`);
    else if (selected.prompt !== line.prompt) {
      errors.push(`Image ${line.key}'s selected take was made with an earlier prompt.`);
    } else if (!line.approved) {
      errors.push(`Image ${line.key} has not been approved.`);
    }
  }
  if (!(state?.lines?.length > 0)) errors.push("There are no images to approve.");
  return { valid: errors.length === 0, errors };
}

export async function prepareImageReview(slug, studioOptions = {}) {
  const projectDir = videoDir(slug);
  const [manifest, basePrompts, overlay, narrationText, audit, previous] = await Promise.all([
    readJson(path.join(projectDir, "public", "generated", "manifest.json")),
    readJson(path.join(projectDir, "content", "image-prompts.json")),
    readJson(path.join(projectDir, "content", "image-prompts.enriched.json")).catch(() => null),
    fs.readFile(path.join(projectDir, "content", "narration.txt"), "utf8").catch(() => ""),
    latestAudit(projectDir),
    loadImageReview(slug),
  ]);
  const narration = narrationText.split(/\r?\n/).filter((line) => line.trim());
  const overlayById = new Map((Array.isArray(overlay) ? overlay : []).map((item) => [item.id, item]));
  const baseById = new Map(basePrompts.map((item) => [item.id, item]));
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const priorById = new Map((previous?.lines ?? []).map((line) => [line.id, line]));
  const lines = [];

  for (const [index, base] of basePrompts.entries()) {
    if (base.kind === "reference") continue;
    const entry = manifestById.get(base.id);
    if (!entry) throw new Error(`Generated manifest is missing image ${base.id}.`);
    const scene = sceneFromAudit(audit, base.id);
    const prompt = overlayById.get(base.id)?.prompt ?? scene?.overlayPrompt ?? base.prompt;
    const take = await archiveCurrentImage(projectDir, entry, scene, audit);
    take.prompt = prompt;
    const prior = priorById.get(base.id);
    lines.push({
      index,
      key: String(index + 1).padStart(2, "0"),
      id: base.id,
      narration: narration[index] ?? "",
      prompt,
      selectedTakeId: take.id,
      approved: false,
      generating: false,
      error: null,
      takes: [...(prior?.takes ?? []), take],
    });
  }

  const state = {
    version: 1,
    status: "awaiting-review",
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: audit?.provider ?? manifest.find((entry) => entry.provider)?.provider ?? null,
    studioOptions: { ...studioOptions },
    lines,
    usage: summarizeUsage(lines, audit),
  };
  await saveState(projectDir, state);
  return state;
}

function requireLine(state, lineIndex) {
  const line = state?.lines?.find((entry) => entry.index === lineIndex);
  if (!line) throw new Error(`Image ${lineIndex + 1} does not exist.`);
  return line;
}

async function updateScenePrompt(projectDir, sceneId, nextPrompt) {
  const basePath = path.join(projectDir, "content", "image-prompts.json");
  const overlayPath = path.join(projectDir, "content", "image-prompts.enriched.json");
  const base = await readJson(basePath);
  const baseScene = base.find((entry) => entry.id === sceneId);
  if (!baseScene) throw new Error(`Scene prompt "${sceneId}" does not exist.`);
  baseScene.prompt = nextPrompt;
  await writeJsonAtomic(basePath, base);

  const overlay = await readJson(overlayPath).catch(() => null);
  if (Array.isArray(overlay)) {
    const scene = overlay.find((entry) => entry.id === sceneId);
    if (scene) {
      scene.prompt = nextPrompt;
      scene.enrichment ??= {};
      scene.enrichment.sourcePrompt = nextPrompt;
      scene.enrichment.reviewEditedAt = new Date().toISOString();
      await writeJsonAtomic(overlayPath, overlay);
    }
  }

  const promptStatePath = path.join(projectDir, "content", "prompt-state.json");
  const promptState = await readJson(promptStatePath).catch(() => ({ version: 1 }));
  promptState.editedSceneIds = [...new Set([...(promptState.editedSceneIds ?? []), sceneId])];
  promptState.preserveEditedScenes = true;
  await writeJsonAtomic(promptStatePath, promptState);
}

export async function editImagePrompt(slug, lineIndex, prompt) {
  const nextPrompt = String(prompt ?? "").trim();
  if (!nextPrompt) throw new Error("An image prompt cannot be empty.");
  if (nextPrompt.length > 2400) throw new Error("An image prompt cannot exceed 2,400 characters.");
  const projectDir = videoDir(slug);
  const state = await loadImageReview(slug);
  if (!state) throw new Error("This project has no image review.");
  const line = requireLine(state, lineIndex);
  if (line.prompt === nextPrompt) return state;
  await updateScenePrompt(projectDir, line.id, nextPrompt);
  line.prompt = nextPrompt;
  line.approved = false;
  line.error = null;
  state.status = "awaiting-review";
  state.usage = summarizeUsage(state.lines, await latestAudit(projectDir));
  await saveState(projectDir, state);
  return state;
}

export async function regenerateImageTake(slug, lineIndex, prompt) {
  const lockKey = `${slug}:${lineIndex}`;
  if (sceneLocks.has(lockKey)) throw new Error(`Image ${lineIndex + 1} is already regenerating.`);
  sceneLocks.add(lockKey);
  const projectDir = videoDir(slug);
  try {
    let state = await editImagePrompt(slug, lineIndex, prompt);
    let line = requireLine(state, lineIndex);
    line.generating = true;
    line.approved = false;
    line.error = null;
    state.status = "generating";
    await saveState(projectDir, state);

    const overlayExists = await fs.access(
      path.join(projectDir, "content", "image-prompts.enriched.json"),
    ).then(() => true, () => false);
    try {
      const args = [
        path.join(repoRoot, "scripts", "generate-images.mjs"),
        "--project",
        slug,
        "--only",
        line.id,
        "--force",
      ];
      if (overlayExists) args.push("--reuse-enriched");
      await run(process.execPath, args);

      state = await loadImageReview(slug);
      line = requireLine(state, lineIndex);
      const [manifest, audit] = await Promise.all([
        readJson(path.join(projectDir, "public", "generated", "manifest.json")),
        latestAudit(projectDir),
      ]);
      const entry = manifest.find((item) => item.id === line.id);
      if (!entry) throw new Error(`The provider did not save image ${line.id}.`);
      const scene = sceneFromAudit(audit, line.id);
      const take = await archiveCurrentImage(projectDir, entry, scene, audit);
      take.prompt = line.prompt;
      line.takes.push(take);
      line.selectedTakeId = take.id;
      line.generating = false;
      line.error = null;
      state.status = "awaiting-review";
      state.provider = audit?.provider ?? state.provider;
      state.usage = summarizeUsage(state.lines, audit);
      await saveState(projectDir, state);
      return state;
    } catch (error) {
      state = (await loadImageReview(slug)) ?? state;
      line = requireLine(state, lineIndex);
      line.generating = false;
      line.error = String(error.message ?? error);
      state.status = "awaiting-review";
      await saveState(projectDir, state);
      throw error;
    }
  } finally {
    sceneLocks.delete(lockKey);
  }
}

export async function selectImageTake(slug, lineIndex, takeId) {
  const projectDir = videoDir(slug);
  const state = await loadImageReview(slug);
  if (!state) throw new Error("This project has no image review.");
  const line = requireLine(state, lineIndex);
  if (line.generating) throw new Error(`Image ${line.key} is still generating.`);
  const take = line.takes.find((entry) => entry.id === takeId);
  if (!take) throw new Error(`Image take "${takeId}" does not exist.`);
  if (take.prompt !== line.prompt) {
    throw new Error("A take made with an earlier prompt cannot be selected.");
  }
  const manifestPath = path.join(projectDir, "public", "generated", "manifest.json");
  const manifest = await readJson(manifestPath);
  const entry = manifest.find((item) => item.id === line.id);
  if (!entry) throw new Error(`Generated manifest is missing image ${line.id}.`);
  await fs.copyFile(path.join(projectDir, take.image), path.join(projectDir, entry.file));
  Object.assign(entry, {
    provider: take.provider,
    model: take.model,
    seed: take.seed,
    prompt: take.finalPrompt,
    negativePrompt: take.negativePrompt,
    selectedTakeId: take.id,
  });
  await writeJsonAtomic(manifestPath, manifest);
  line.selectedTakeId = take.id;
  line.approved = false;
  line.error = null;
  state.status = "awaiting-review";
  await saveState(projectDir, state);
  return state;
}

export async function approveImage(slug, lineIndex) {
  const projectDir = videoDir(slug);
  const state = await loadImageReview(slug);
  if (!state) throw new Error("This project has no image review.");
  const line = requireLine(state, lineIndex);
  if (line.generating) throw new Error(`Image ${line.key} is still generating.`);
  const selected = line.takes.find((take) => take.id === line.selectedTakeId);
  if (!selected) throw new Error(`Image ${line.key} has no selected take.`);
  if (selected.prompt !== line.prompt) {
    throw new Error(`Image ${line.key} was generated from an earlier prompt. Regenerate it first.`);
  }
  line.approved = true;
  line.error = null;
  state.status = validateImageReview(state).valid ? "ready-to-continue" : "awaiting-review";
  await saveState(projectDir, state);
  return state;
}

export async function approveImageReview(slug) {
  const projectDir = videoDir(slug);
  const state = await loadImageReview(slug);
  if (!state) throw new Error("This project has no image review.");
  const validation = validateImageReview(state);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  state.status = "approved";
  state.approvedAt = new Date().toISOString();
  await saveState(projectDir, state);
  return state;
}
