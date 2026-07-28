import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJson, repoRoot, videoDir } from "./lib.mjs";

export const PROMPT_FIELDS = ["sceneTemplate", "stylePrompt", "negativePrompt"];
export const PROMPT_VARIABLES = new Set([
  "{{line}}",
  "{{keywords}}",
  "{{subjectType}}",
  "{{sentiment}}",
  "{{storyBeat}}",
  "{{visualAction}}",
  "{{shotPlan}}",
  "{{castPlan}}",
  "{{continuity}}",
]);

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

function storyBeatFor(index, total) {
  if (total <= 1) return "standalone emotional beat";
  if (index === 0) return "opening and first encounter";
  if (index === total - 1) return "resolution and emotional choice";
  const progress = index / (total - 1);
  if (progress < 0.34) return "connection deepening";
  if (progress < 0.67) return "turning point and emotional complication";
  return "reflection leading toward resolution";
}

function sentimentFor(line) {
  const value = line.toLowerCase();
  if (/\b(?:fought|fight|argument|argued|angry|hurt|betray|blame)\b/.test(value)) {
    return "hurt and tension softening into vulnerable reconciliation";
  }
  if (/\b(?:left|leave|leaving|goodbye|gone|lost|missing|grief|grieving)\b/.test(value)) {
    return "grief, distance, and aching absence";
  }
  if (/\b(?:alone|lonely|empty|silence|forgotten)\b/.test(value)) {
    return "quiet loneliness and inward reflection";
  }
  if (/\b(?:laughed|laugh|smiled|smile|joy|happy)\b/.test(value)) {
    return "unforced joy, surprise, and growing affection";
  }
  if (/\b(?:love|loved|home|stay|stayed|choose|choice|lucky|together)\b/.test(value)) {
    return "tender intimacy, safety, and deliberate commitment";
  }
  if (/\b(?:remember|memory|noticed|realized|thought|thinking)\b/.test(value)) {
    return "gentle realization and affectionate reflection";
  }
  return "restrained warmth and emotionally honest reflection";
}

function castPlanFor(index, total) {
  const turningPoint = Math.round((total - 1) * 0.57);
  if (index === 0 || index === total - 1 || (total >= 5 && index === turningPoint)) {
    return {
      castMode: "pair",
      castPlan:
        "Two-person turning-point scene: show the recurring adult woman and adult man together in one shared action, with natural distance or contact dictated by the narration; never pose them as a static matched pair.",
    };
  }
  const womanSolo = index % 2 === 1;
  return {
    castMode: womanSolo ? "solo-a" : "solo-b",
    castPlan: womanSolo
      ? "Solo-woman scene: show only the recurring adult woman as the complete human figure. Suggest the man only indirectly through an off-frame hand, cast shadow, reflection, empty chair, second cup, keepsake, or negative space when the story needs his presence. Do not show a second complete person."
      : "Solo-man scene: show only the recurring adult man as the complete human figure. Suggest the woman only indirectly through an off-frame hand, cast shadow, reflection, empty chair, second cup, keepsake, or negative space when the story needs her presence. Do not show a second complete person.",
  };
}

function sceneDirectionFor(line, index, castMode) {
  const value = line.toLowerCase();
  const featured = castMode === "solo-a" ? "woman" : "man";

  if (/\bmet\b|\bfirst encounter\b/.test(value)) {
    return {
      visualAction:
        "Two adults cross paths in an unmistakably ordinary weekday place such as a small shop, bus stop, or office lobby; one pauses and glances back while a mundane Tuesday detail grounds the meeting.",
      shotPlan:
        "Wide establishing view with both people separated in depth, everyday surroundings visible, and the meeting happening through movement rather than a posed face-to-face portrait.",
    };
  }
  if (/\b(?:laughed|laughing|laugh)\b/.test(value)) {
    return {
      visualAction:
        `Feature the solo adult ${featured} smiling and losing their train of thought as laughter comes from just outside the frame; imply the unseen partner through one hand at the edge, a shifted chair, or a cast shadow.`,
      shotPlan:
        "Lively medium side view with one expressive face and suspended conversational gesture prominent; keep the unseen partner outside the composition.",
    };
  }
  if (/\b(?:stayed up|up too late|talking all night|talked all night)\b/.test(value)) {
    return {
      visualAction:
        `Show the solo adult ${featured} seated on a sofa or floor late at night, leaning toward someone just beyond the frame in deep conversation; two cooling mugs, an empty foreground seat, a dim lamp, and a late clock imply the relationship.`,
      shotPlan:
        "Intimate interior three-quarter view with one complete figure in warm lamplight, an empty conversational space in the foreground, and nighttime darkness around them.",
    };
  }
  if (/\bcoffee\b|\btea\b/.test(value) && /\border\b|\bcup\b|\bdrink\b/.test(value)) {
    return {
      visualAction:
        `Feature the solo adult ${featured} receiving their familiar coffee order before asking; only the unseen partner's hand enters the frame to place the cup as recognition and unspoken affection register.`,
      shotPlan:
        "Close over-the-shoulder detail built around the cup, hands, and small surprised expression; use a café counter or kitchen table, not a seaside landscape.",
    };
  }
  if (/\b(?:fought|fight|argument|argued|making up|made up|forgive|forgave)\b/.test(value)) {
    return {
      visualAction:
        "After a small argument, the pair begin on opposite sides of a room with guarded posture, then bridge the distance through a tentative touch that feels like returning home.",
      shotPlan:
        "Wide interior composition using negative space between them, a doorway or table dividing the frame, and joined hands becoming the focal point.",
    };
  }
  if (/\b(?:fall asleep|fell asleep|asleep|sleeping)\b/.test(value)) {
    return {
      visualAction:
        `Feature the solo adult ${featured} awake at the bedside with a tender, grateful expression; imply the sleeping partner only as a softly abstracted blanket shape, hand, or shadow rather than a second complete figure.`,
      shotPlan:
        "Quiet intimate bedroom view from above or beside the bed, with one readable face, blanket folds, and soft shadow carrying the absent partner's presence.",
    };
  }
  if (/\bfireworks?\b|\bquietly wanting\b|\bwanting to stay\b/.test(value)) {
    return {
      visualAction:
        `Instead of spectacle, show the solo adult ${featured} setting down keys and a coat by the door, choosing not to leave; an empty lit chair, second mug, or familiar shadow quietly implies the loved one.`,
      shotPlan:
        "Restrained domestic wide shot with one complete person, the doorway and set-down keys visible, warm evening light, and no fireworks or grand romantic pose.",
    };
  }
  if (
    /\b(?:choose|choice)\b.*\bstay\b|\bso i stay\b|\bdecide\b.*\bstay\b|\bevery single day\b/.test(
      value,
    )
  ) {
    return {
      visualAction:
        "At morning light, the pair deliberately move further into their shared home together, one reaching back for the other's hand as the open doorway remains behind them.",
      shotPlan:
        "Resolved rear three-quarter view with forward movement, joined hands, warm light ahead, and a noticeably different angle from every earlier scene.",
    };
  }
  if (/\b(?:suitcase|packed|depart|goodbye|left me|walked away)\b/.test(value)) {
    return {
      visualAction:
        "A departing adult carries a suitcase through a doorway while the person left behind reaches out but stops short, making the emotional distance physical.",
      shotPlan:
        "Deep hallway or station composition with the figures moving in opposite directions and strong distance between foreground and background.",
    };
  }
  if (/\b(?:rain|storm|umbrella)\b/.test(value)) {
    return {
      visualAction:
        "The emotion becomes physical through rain: one adult hesitates beneath an umbrella while the other crosses the wet street toward or away from them.",
      shotPlan:
        "Vertical exterior view with reflections, diagonal movement, and the umbrella used as a clear story prop rather than decoration.",
    };
  }
  if (/\b(?:photo|photograph|memory|remember)\b/.test(value)) {
    return {
      visualAction:
        "An adult handles a worn photograph or keepsake while the remembered relationship appears only through their expression, hands, and the empty place beside them.",
      shotPlan:
        "Close interior composition focused on hands and the keepsake, with an empty chair or unoccupied side of the frame carrying the absence.",
    };
  }

  const fallbackShots = [
    "Wide environmental view with the character actively moving through the setting.",
    "Medium side view centered on a specific hand gesture and one meaningful prop.",
    "Intimate over-the-shoulder composition with foreground depth and a changed location.",
    "High or low angle that makes the emotional power relationship physically readable.",
  ];
  return {
    visualAction:
      "Translate the narration into one specific physical action with a meaningful prop and an environment that reveals the emotion; do not merely pose characters together.",
    shotPlan: fallbackShots[index % fallbackShots.length],
  };
}

export function buildScenePrompt(line, index, template, context = {}) {
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
  const total = Number(context.total ?? context.lines?.length ?? index + 1);
  const { castMode, castPlan } = castPlanFor(index, total);
  const { visualAction, shotPlan } = sceneDirectionFor(promptLine, index, castMode);
  const continuity =
    `Scene ${index + 1} of ${total}. Preserve recurring character identity and clothing, ` +
    "but change the pose, action, prop, location, camera distance, horizon, and lighting from neighboring scenes.";
  const prompt = template
    .replaceAll("{{line}}", promptLine)
    .replaceAll("{{keywords}}", words.slice(0, 6).join(", "))
    .replaceAll("{{subjectType}}", subjectType)
    .replaceAll("{{sentiment}}", sentimentFor(promptLine))
    .replaceAll("{{storyBeat}}", storyBeatFor(index, total))
    .replaceAll("{{visualAction}}", visualAction)
    .replaceAll("{{shotPlan}}", shotPlan)
    .replaceAll("{{castPlan}}", castPlan)
    .replaceAll("{{continuity}}", continuity);
  const unresolved = prompt.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unknown prompt variable(s): ${[...new Set(unresolved)].join(", ")}.`);
  }
  return { id: `${String(index + 1).padStart(2, "0")}-${slug}`, prompt, castMode };
}

export function buildScenePrompts(lines, template) {
  return lines.map((line, index) =>
    buildScenePrompt(line, index, template, { lines, total: lines.length }),
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
