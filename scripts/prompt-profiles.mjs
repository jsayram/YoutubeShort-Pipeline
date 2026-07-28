import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJson, repoRoot, videoDir } from "./lib.mjs";

export const PROMPT_FIELDS = ["sceneTemplate", "stylePrompt", "negativePrompt"];
export const PROMPT_VARIABLES = new Set(["{{line}}", "{{keywords}}", "{{subjectType}}"]);

const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those it its is are was were be been being " +
    "of to in on at for with from by as into about over under your you i me we us they them he him she her my our " +
    "can will just also not no do does did have has had how what when where which who why").split(" "),
);
const PERSON_SIGNAL =
  /\b(?:i|me|my|mine|you|your|yours|we|our|ours|he|him|his|she|her|hers|they|them|their|person|people|human|man|woman|boy|girl|child|ghost|thief|lover|friend)\b/i;

export function defaultPromptPath(root = repoRoot) {
  return path.join(root, "templates", "prompt.json");
}

export function promptBackupDir(root = repoRoot) {
  return path.join(root, "templates", "prompt-backups");
}

export function promptOverridePath(projectPath) {
  return path.join(projectPath, "content", "prompt-overrides.json");
}

export function promptStatePath(projectPath) {
  return path.join(projectPath, "content", "prompt-state.json");
}

export function imagePromptsPath(projectPath) {
  return path.join(projectPath, "content", "image-prompts.json");
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, filePath);
}

function pickEditableFields(value = {}) {
  return Object.fromEntries(
    PROMPT_FIELDS.map((field) => [field, String(value[field] ?? "")]),
  );
}

export function validatePromptFields(value, { requireAll = true } = {}) {
  const fields = pickEditableFields(value);
  if (requireAll) {
    for (const [field, text] of Object.entries(fields)) {
      if (!text.trim()) throw new Error(`${field} cannot be empty.`);
    }
  }
  const variables = fields.sceneTemplate.match(/\{\{[^}]+\}\}/g) ?? [];
  const unknown = [...new Set(variables.filter((variable) => !PROMPT_VARIABLES.has(variable)))];
  if (unknown.length) {
    throw new Error(`Unknown prompt variable(s): ${unknown.join(", ")}.`);
  }
  if (!fields.sceneTemplate.includes("{{line}}") && !fields.sceneTemplate.includes("{{keywords}}")) {
    throw new Error("The scene template must include {{line}} or {{keywords}}.");
  }
  return fields;
}

export async function loadPromptDocument(promptPath = defaultPromptPath()) {
  const document = await readJson(promptPath);
  if (!document?.providers || typeof document.providers !== "object") {
    throw new Error(`${promptPath} has no providers object.`);
  }
  return document;
}

export async function loadProjectPromptOverrides(projectPath) {
  return readJson(promptOverridePath(projectPath)).catch(() => ({
    version: 1,
    providers: {},
  }));
}

export async function resolveProjectPromptProfile({
  profileId,
  projectPath,
  promptPath = defaultPromptPath(),
}) {
  const document = await loadPromptDocument(promptPath);
  const providerDefault = document.providers[profileId];
  if (!providerDefault) throw new Error(`Unknown prompt profile "${profileId}".`);
  const overrides = projectPath
    ? await loadProjectPromptOverrides(projectPath)
    : { providers: {} };
  const projectOverride = overrides.providers?.[profileId] ?? null;
  const effective = {
    ...providerDefault,
    ...(projectOverride ? pickEditableFields(projectOverride) : {}),
  };
  return {
    providerDefault,
    projectOverride,
    effective,
    variables: document.variables ?? {},
  };
}

export async function saveProjectPromptOverride({ profileId, projectPath, values }) {
  const fields = validatePromptFields(values);
  const document = await loadProjectPromptOverrides(projectPath);
  document.version = 1;
  document.providers ??= {};
  document.providers[profileId] = {
    ...fields,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(promptOverridePath(projectPath), document);
  return document.providers[profileId];
}

export async function resetProjectPromptOverride({ profileId, projectPath }) {
  const document = await loadProjectPromptOverrides(projectPath);
  if (!document.providers?.[profileId]) return false;
  delete document.providers[profileId];
  await writeJsonAtomic(promptOverridePath(projectPath), document);
  return true;
}

export function buildScenePrompt(line, index, template) {
  const keywordSource = line.replace(
    /\bleaves?\b(?=\s+(?:me|you|us|them|him|her|it)\b)/gi,
    "",
  );
  const words = keywordSource
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
  const slug = words.slice(0, 3).join("-") || `beat-${index + 1}`;
  const subjectType = PERSON_SIGNAL.test(line)
    ? "one human figure, full body"
    : "one clearly recognizable non-human subject";
  const promptLine = line.replace(/[,.!?;:]+$/, "").trim();
  const prompt = template
    .replaceAll("{{line}}", promptLine)
    .replaceAll("{{keywords}}", words.slice(0, 6).join(", "))
    .replaceAll("{{subjectType}}", subjectType);
  const unresolved = prompt.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unknown prompt variable(s): ${[...new Set(unresolved)].join(", ")}.`);
  }
  return { id: `${String(index + 1).padStart(2, "0")}-${slug}`, prompt };
}

export function buildScenePrompts(lines, template) {
  return lines.map((line, index) => buildScenePrompt(line, index, template));
}

export async function loadPromptState(projectPath) {
  return readJson(promptStatePath(projectPath)).catch(() => ({
    version: 1,
    provider: null,
    editedSceneIds: [],
    preserveEditedScenes: false,
  }));
}

export async function saveScenePrompts({
  profileId,
  projectPath,
  scenes,
  editedSceneIds,
}) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("No scene prompts were supplied.");
  const normalized = scenes.map((scene) => {
    const id = String(scene.id ?? "").trim();
    const prompt = String(scene.prompt ?? "").trim();
    if (!id || !prompt) throw new Error("Every scene needs an id and prompt.");
    return { id, prompt };
  });
  const known = new Set(normalized.map((scene) => scene.id));
  const edited = [...new Set((editedSceneIds ?? []).map(String))].filter((id) => known.has(id));
  await writeJsonAtomic(imagePromptsPath(projectPath), normalized);
  await writeJsonAtomic(promptStatePath(projectPath), {
    version: 1,
    provider: profileId,
    editedSceneIds: edited,
    preserveEditedScenes: edited.length > 0,
    updatedAt: new Date().toISOString(),
  });
  return { scenes: normalized, editedSceneIds: edited };
}

export async function regenerateProjectScenePrompts({
  profileId,
  projectPath,
  preserveEdited = true,
  promptPath = defaultPromptPath(),
}) {
  const narration = await fs.readFile(path.join(projectPath, "content", "narration.txt"), "utf8");
  const lines = narration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("This project has no narration lines.");
  const { effective } = await resolveProjectPromptProfile({
    profileId,
    projectPath,
    promptPath,
  });
  const generated = buildScenePrompts(lines, effective.sceneTemplate);
  const existing = await readJson(imagePromptsPath(projectPath)).catch(() => []);
  const state = await loadPromptState(projectPath);
  const editedIds =
    preserveEdited && state.provider === profileId
      ? new Set(state.editedSceneIds ?? [])
      : new Set();

  const scenes = generated.map((scene, index) => {
    const previous = existing[index];
    if (previous && editedIds.has(previous.id)) {
      return { ...scene, prompt: String(previous.prompt) };
    }
    return scene;
  });
  const nextEditedIds = scenes
    .map((scene, index) => (existing[index] && editedIds.has(existing[index].id) ? scene.id : null))
    .filter(Boolean);
  await saveScenePrompts({
    profileId,
    projectPath,
    scenes,
    editedSceneIds: nextEditedIds,
  });
  return { scenes, editedSceneIds: nextEditedIds, lines };
}

function backupTimestamp() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export async function promoteProviderDefault({
  profileId,
  values,
  confirmation,
  promptPath = defaultPromptPath(),
  backupDir = promptBackupDir(),
}) {
  if (confirmation !== "MAKE DEFAULT") {
    throw new Error('Type "MAKE DEFAULT" to change future-video defaults.');
  }
  const fields = validatePromptFields(values);
  const document = await loadPromptDocument(promptPath);
  if (!document.providers[profileId]) throw new Error(`Unknown prompt profile "${profileId}".`);
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `${backupTimestamp()}-${profileId}-prompt.json`,
  );
  await writeJsonAtomic(backupPath, document);
  document.providers[profileId] = {
    ...document.providers[profileId],
    ...fields,
  };
  await writeJsonAtomic(promptPath, document);
  return { backupPath, provider: document.providers[profileId] };
}

export async function listPromptBackups({
  profileId,
  backupDir = promptBackupDir(),
} = {}) {
  const names = await fs.readdir(backupDir).catch(() => []);
  return names
    .filter((name) => name.endsWith("-prompt.json"))
    .filter((name) => !profileId || name.includes(`-${profileId}-prompt.json`))
    .sort()
    .reverse()
    .map((name) => ({ name, path: path.join(backupDir, name) }));
}

export async function restoreProviderDefault({
  profileId,
  backupName,
  confirmation,
  promptPath = defaultPromptPath(),
  backupDir = promptBackupDir(),
}) {
  if (confirmation !== "RESTORE DEFAULT") {
    throw new Error('Type "RESTORE DEFAULT" to restore a provider default.');
  }
  const safeName = path.basename(String(backupName ?? ""));
  if (!safeName || safeName !== backupName || !safeName.endsWith("-prompt.json")) {
    throw new Error("Invalid backup name.");
  }
  const backup = await loadPromptDocument(path.join(backupDir, safeName));
  const previous = backup.providers[profileId];
  if (!previous) throw new Error(`That backup has no "${profileId}" provider.`);
  const current = await loadPromptDocument(promptPath);
  await fs.mkdir(backupDir, { recursive: true });
  const safetyPath = path.join(
    backupDir,
    `${backupTimestamp()}-${profileId}-prompt.json`,
  );
  await writeJsonAtomic(safetyPath, current);
  current.providers[profileId] = previous;
  await writeJsonAtomic(promptPath, current);
  return { safetyPath, provider: previous };
}

export async function promptEditorState({ slug, profileId }) {
  const projectPath = slug ? videoDir(slug) : null;
  const projectExists = projectPath
    ? await fs.access(projectPath).then(() => true, () => false)
    : false;
  const resolved = await resolveProjectPromptProfile({
    profileId,
    projectPath: projectExists ? projectPath : null,
  });
  const scenes = projectExists
    ? await readJson(imagePromptsPath(projectPath)).catch(() => [])
    : [];
  const narration = projectExists
    ? await fs.readFile(path.join(projectPath, "content", "narration.txt"), "utf8").catch(() => "")
    : "";
  const lines = narration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const state = projectExists ? await loadPromptState(projectPath) : null;
  const backups = await listPromptBackups({ profileId });
  const generatedScenes = lines.length
    ? buildScenePrompts(lines, resolved.effective.sceneTemplate)
    : [];
  return {
    profileId,
    projectExists,
    providerDefault: pickEditableFields(resolved.providerDefault),
    projectOverride: resolved.projectOverride
      ? pickEditableFields(resolved.projectOverride)
      : null,
    effective: pickEditableFields(resolved.effective),
    variables: resolved.variables,
    scenes,
    generatedScenes,
    lines,
    editedSceneIds: state?.provider === profileId ? state.editedSceneIds ?? [] : [],
    preserveEditedScenes:
      state?.provider === profileId && state.preserveEditedScenes === true,
    backups: backups.map(({ name }) => name),
  };
}
