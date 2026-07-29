import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJson, repoRoot, videoDir } from "./lib.mjs";
import { DEFAULT_TOPIC_ID, resolveTopic } from "./topics.mjs";

export const PROMPT_FIELDS = ["sceneTemplate", "stylePrompt", "negativePrompt"];
export const PROMPT_VARIABLES = new Set([
  "{{line}}",
  "{{keywords}}",
  "{{keywordsAll}}",
  "{{subjectType}}",
  "{{sentiment}}",
  "{{storyBeat}}",
  "{{visualAction}}",
  "{{shotPlan}}",
  "{{castPlan}}",
  "{{castBrief}}",
  "{{castTags}}",
  "{{topicDirection}}",
  "{{age}}",
  "{{ageDetail}}",
  "{{continuity}}",
]);

// Ordinary English stopwords, deliberately not topic-specific: keyword extraction works the same
// whether the line is about a breakup or a bond yield. Everything that *is* topic-specific —
// cast, sentiment vocabulary, story arc, scene direction — now lives in templates/topics/*.json.
const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those it its is are was were be been being " +
    "of to in on at for with from by as into about over under your you i me we us they them he him she her my our " +
    "can will just also not no do does did have has had how what when where which who why " +
    // Non-visual: these describe thought or speech, not anything that can appear in a frame.
    "realized realize realizing know knew knows think thought thinking feel felt feels want " +
    "wanted need needed try tried say said says tell told ask asked call called wonder wondered " +
    "remember remembered forget forgot mean meant seem seemed become became still even though " +
    "ago now today never always ever really very much more most back again once already yet " +
    // Contraction remnants left after apostrophes are joined.
    "havent hasnt hadnt dont doesnt didnt wasnt werent isnt arent wont cant couldnt shouldnt " +
    "wouldnt im ive ill id youre youve youll theyre theyve thats its lets").split(" "),
);

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

// Every function below reads its vocabulary from a topic pack (templates/topics/*.json) instead
// of hardcoding it. That is the whole point of the split: the engine renders, the look styles,
// and the topic decides what the scene is actually about.

function matches(pattern, value) {
  return new RegExp(pattern, "i").test(value);
}

function storyBeatFor(index, total, topic) {
  const beats = topic.storyBeats;
  if (total <= 1) return beats.single;
  if (index === 0) return beats.opening;
  if (index === total - 1) return beats.final;
  const progress = index / (total - 1);
  if (progress < 0.34) return beats.early;
  if (progress < 0.67) return beats.middle;
  return beats.late;
}

function sentimentFor(line, topic) {
  const value = line.toLowerCase();
  for (const rule of topic.sentimentRules ?? []) {
    if (matches(rule.match, value)) return rule.phrase;
  }
  return topic.fallbackSentiment;
}

// A topic with `cast.mode: "none"` (crypto, coding, animals) returns empty strings here, and
// buildScenePrompt then strips the gap they leave behind — so a non-people topic never gets a
// recurring couple injected into its scenes.
// Anchor scenes (open, turning point, close) show the couple. Everything between alternates an
// object-only still with a solo figure. The sequence is computed across the whole video rather
// than derived from the index alone, because the anchors interrupt the rhythm and a naive
// index%2 makes the same character appear twice in a row.
function castModeSequence(total, cast) {
  const turningPoint = Math.round((total - 1) * (cast.pairAtTurningPointRatio ?? 0.57));
  const modes = [];
  let betweenCount = 0;
  let soloCount = 0;
  for (let i = 0; i < total; i += 1) {
    if (i === 0 || i === total - 1 || (total >= 5 && i === turningPoint)) {
      modes.push("pair");
      continue;
    }
    if (cast.objectPlan && betweenCount % 2 === 0) {
      modes.push("object");
    } else {
      modes.push(soloCount % 2 === 0 ? "solo-a" : "solo-b");
      soloCount += 1;
    }
    betweenCount += 1;
  }
  return modes;
}

function castPlanFor(index, total, topic) {
  const cast = topic.cast ?? { mode: "none" };
  if (cast.mode !== "recurring-pair") {
    return { castMode: "", castPlan: "", castBrief: "" };
  }
  const mode = castModeSequence(total, cast)[index] ?? "pair";
  const byMode = {
    pair: { castPlan: cast.pairPlan, castBrief: cast.pairBrief },
    object: { castPlan: cast.objectPlan, castBrief: cast.objectBrief ?? "" },
    "solo-a": { castPlan: cast.soloAPlan, castBrief: cast.soloABrief },
    "solo-b": { castPlan: cast.soloBPlan, castBrief: cast.soloBBrief },
  };
  return { castMode: mode, ...byMode[mode] };
}

function sceneDirectionFor(line, index, castMode, topic) {
  const value = line.toLowerCase();
  const cast = topic.cast ?? {};
  const featured =
    castMode === "solo-a" ? (cast.soloALabel ?? "") : (cast.soloBLabel ?? "");

  for (const rule of topic.sceneDirectionRules ?? []) {
    if (!matches(rule.match, value)) continue;
    if (rule.and && !matches(rule.and, value)) continue;
    return {
      visualAction: rule.visualAction.replaceAll("{{featured}}", featured),
      shotPlan: rule.shotPlan.replaceAll("{{featured}}", featured),
    };
  }

  const group = castMode === "pair" ? "pair" : castMode === "object" ? "object" : "solo";
  const actions = topic.fallbackVisualActions?.[group] ?? [];
  const fallbackShots = topic.fallbackShots ?? [];
  return {
    visualAction: actions.length
      ? actions[index % actions.length]
      : (topic.fallbackVisualAction ?? ""),
    shotPlan: fallbackShots.length ? fallbackShots[index % fallbackShots.length] : "",
  };
}

export async function resolveTopicPack(topicId) {
  return resolveTopic(topicId ?? DEFAULT_TOPIC_ID);
}

// Age is decided once for the whole script, never per line: the cast recurs across every scene,
// so a line mentioning "old" must not age the couple mid-video. Returns null for topics with no
// cast, and the matching override (or the default) otherwise.
export function resolveCastAge(scriptText, topic) {
  const age = topic?.cast?.age;
  if (!age) return null;
  const value = String(scriptText ?? "").toLowerCase();
  for (const rule of age.overrideRules ?? []) {
    if (matches(rule.match, value)) return rule;
  }
  return age.default ?? null;
}

export function buildScenePrompt(line, index, template, context = {}) {
  const topic = context.topic;
  if (!topic) throw new Error("buildScenePrompt needs a topic pack; see scripts/topics.mjs.");

  const keywordSource = topic.keywordStripPattern
    ? line.replace(new RegExp(topic.keywordStripPattern, "gi"), "")
    : line;
  const words = keywordSource
    .toLowerCase()
    // Join contractions before stripping punctuation, otherwise "haven't" becomes "haven" + "t"
    // and the stray letter is fed to the model as a visual anchor.
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const slug = words.slice(0, 3).join("-") || `beat-${index + 1}`;
  const subjectType = matches(topic.personSignal, line)
    ? topic.subjectTypePerson
    : topic.subjectTypeOther;
  const promptLine = line.replace(/[,.!?;:]+$/, "").trim();
  const total = Number(context.total ?? context.lines?.length ?? index + 1);
  // Resolved from the full script when available so every scene shares one age.
  const castAge =
    context.castAge ?? resolveCastAge((context.lines ?? [line]).join(" "), topic);
  const { castMode, castPlan, castBrief } = castPlanFor(index, total, topic);
  const { visualAction, shotPlan } = sceneDirectionFor(promptLine, index, castMode, topic);
  const continuity = topic.continuityTemplate
    .replaceAll("{{sceneNumber}}", String(index + 1))
    .replaceAll("{{total}}", String(total));
  const prompt = template
    .replaceAll("{{line}}", promptLine)
    .replaceAll("{{keywords}}", words.slice(0, 6).join(", "))
    .replaceAll("{{keywordsAll}}", words.join(", "))
    .replaceAll("{{subjectType}}", subjectType)
    .replaceAll("{{sentiment}}", sentimentFor(promptLine, topic))
    .replaceAll("{{storyBeat}}", storyBeatFor(index, total, topic))
    .replaceAll("{{visualAction}}", visualAction)
    .replaceAll("{{shotPlan}}", shotPlan)
    .replaceAll("{{castPlan}}", castPlan)
    .replaceAll("{{castBrief}}", castBrief)
    .replaceAll("{{castTags}}", topic.castTags ?? "")
    .replaceAll("{{topicDirection}}", topic.topicDirection ?? "")
    .replaceAll("{{continuity}}", continuity)
    .replaceAll("{{age}}", castAge?.descriptor ?? "")
    .replaceAll("{{ageDetail}}", castAge?.detail ?? "");
  const unresolved = prompt.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unknown prompt variable(s): ${[...new Set(unresolved)].join(", ")}.`);
  }
  // A cast-less topic leaves holes where {{castPlan}} and {{castBrief}} used to sit. Tidy the
  // doubled spaces and orphaned punctuation they leave behind. This is a no-op for a topic that
  // fills every variable, so romance output is unaffected.
  const tidied = prompt
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
  return { id: `${String(index + 1).padStart(2, "0")}-${slug}`, prompt: tidied, castMode };
}

export function buildScenePrompts(lines, template, topic) {
  const castAge = resolveCastAge(lines.join(" "), topic);
  return lines.map((line, index) =>
    buildScenePrompt(line, index, template, {
      lines,
      total: lines.length,
      topic,
      castAge,
    }),
  );
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
  const previous = await readJson(imagePromptsPath(projectPath)).catch(() => []);
  const previousById = new Map(previous.map((scene) => [String(scene.id), scene]));
  const normalized = scenes.map((scene) => {
    const id = String(scene.id ?? "").trim();
    const prompt = String(scene.prompt ?? "").trim();
    if (!id || !prompt) throw new Error("Every scene needs an id and prompt.");
    const castMode = String(scene.castMode ?? previousById.get(id)?.castMode ?? "").trim();
    return castMode ? { id, prompt, castMode } : { id, prompt };
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
  topicId,
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
  // The project's own video.json is the source of truth for topic, so a CLI run and a Studio run
  // on the same project always build the same prompts.
  const resolvedTopicId =
    topicId ??
    (await readJson(path.join(projectPath, "video.json"))
      .then((config) => config.topic)
      .catch(() => null)) ??
    DEFAULT_TOPIC_ID;
  const topic = await resolveTopic(resolvedTopicId);
  const generated = buildScenePrompts(lines, effective.sceneTemplate, topic);
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
