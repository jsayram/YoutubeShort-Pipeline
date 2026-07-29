import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, parseArgs, readJson, videoDir, writeJson } from "./lib.mjs";
import { applyStyle, loadStyles, resolveStyles } from "./image-styles.mjs";
import {
  loadPromptState,
  regenerateProjectScenePrompts,
  resolveCastAge,
  resolveProjectPromptProfile,
} from "./prompt-profiles.mjs";
import { DEFAULT_TOPIC_ID, resolveTopic } from "./topics.mjs";

await loadEnv();

// Turns a pasted script into the two content files the rest of the pipeline reads:
// content/narration.txt (one spoken beat per line) and content/image-prompts.json (one wordless
// still per beat). Everything downstream already knows how to consume those, so the studio UI
// does not need its own path into the pipeline.

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const configPath = path.join(projectDir, "video.json");
const config = await readJson(configPath);

const source = flags.script
  ? await fs.readFile(path.resolve(flags.script), "utf8")
  : await readStdin();

// A blank line, or a line break, both mean "new spoken beat". Sentences that arrive as one
// long paragraph get split on sentence boundaries so Voicebox still gets usable clip lengths.
const lines = source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .flatMap((line) => (line.length > 320 ? splitSentences(line) : [line]));

if (!lines.length) throw new Error("The script is empty.");

const WORDS_PER_SECOND = 2.6;
const gapMs = Math.max(
  0,
  Math.round(Number(flags.gap ?? config.voicebox?.gapMs ?? 3000)),
);
const GAP_SECONDS = gapMs / 1000;
const totalWords = lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0);
const estimated = totalWords / WORDS_PER_SECOND + GAP_SECONDS * (lines.length - 1);
const tail = Number(flags.tail ?? (config.voicebox?.finalHoldMs ?? gapMs) / 1000);

await fs.mkdir(path.join(projectDir, "content"), { recursive: true });
await fs.writeFile(path.join(projectDir, "content", "narration.txt"), `${lines.join("\n")}\n`);

// Prompts are only rewritten when asked, so hand-tuned art direction survives a re-run of the
// script step.
const promptsPath = path.join(projectDir, "content", "image-prompts.json");
const existing = await readJson(promptsPath).catch(() => null);
const keep = flags["keep-prompts"] === true || flags["keep-prompts"] === "true";
const selectedStyleId = String(flags.style ?? config.imageGen?.style ?? "photographic");
const localStyles = await loadStyles();
const selectedStyle = localStyles.find((style) => style.id === selectedStyleId);
const profileId = selectedStyle?.promptProfile ?? selectedStyleId;
const { effective: effectivePromptProfile, projectOverride } =
  await resolveProjectPromptProfile({ profileId, projectPath: projectDir });
// Topic is independent of both the engine and the look: it decides what the scenes are about,
// so the same style can serve romance today and crypto or animals later. It sticks to the
// project so a later CLI run builds the same prompts as the Studio run that created it.
const selectedTopicId = String(flags.topic ?? config.topic ?? DEFAULT_TOPIC_ID);
const topic = await resolveTopic(selectedTopicId);
config.topic = topic.id;
// Age comes from the whole script, so the recurring cast never changes age between scenes.
const castAge = resolveCastAge(lines.join(" "), topic);

const promptState = await loadPromptState(projectDir);
const hasTrackedEdits =
  promptState.provider === profileId && (promptState.editedSceneIds?.length ?? 0) > 0;

// Old projects predate prompt-state.json. Honour their historical checkbox behavior once by
// keeping the complete file; after the user edits through Studio, only the explicitly edited
// scenes are protected and every untouched scene can follow the current template.
if (
  keep &&
  !hasTrackedEdits &&
  Array.isArray(existing) &&
  existing.length >= lines.length
) {
  console.log(`Kept ${existing.length} existing image prompt(s).`);
} else {
  const regenerated = await regenerateProjectScenePrompts({
    profileId,
    projectPath: projectDir,
    topicId: topic.id,
    preserveEdited: keep,
  });
  console.log(
    keep && regenerated.editedSceneIds.length
      ? `Preserved ${regenerated.editedSceneIds.length} edited scene prompt(s).`
      : `Regenerated all ${regenerated.scenes.length} scene prompt(s).`,
  );
  console.log(
    `Prompt profile: ${profileId} (${projectOverride ? "video override" : "provider default"}).`,
  );
  console.log(`Topic: ${topic.id} (${topic.label})${castAge ? ` · cast: ${castAge.descriptor}` : ""}.`);
  console.log(`Wrote ${lines.length} image prompt(s).`);
}

if (flags.title) config.title = String(flags.title);

// The voice belongs to the project, not to one invocation. Writing it here means the story step
// picks it up without being told again, whether it runs from the studio or the command line.
if (flags.profile) {
  config.voicebox = { ...config.voicebox, profile: String(flags.profile) };
  if (flags.engine) config.voicebox.engine = String(flags.engine);
  console.log(
    `Voice: ${config.voicebox.profile}${flags.engine ? ` on ${config.voicebox.engine}` : ""}.`,
  );
}
config.voicebox = {
  ...config.voicebox,
  gapMs,
  finalHoldMs: Number(config.voicebox?.finalHoldMs ?? gapMs),
};

// Captions are opt-in. Studio always passes an explicit value so a project's saved setting
// matches the toggle that produced its current composition.
if (flags.captions !== undefined) {
  const enabled = parseBoolean(flags.captions);
  config.captions = { ...config.captions, enabled };
  console.log(`Active-word captions: ${enabled ? "enabled" : "off"}.`);
}

// Same idea for the visual style: resolve the preset against the models that are actually
// installed and flatten it into imageGen, so the generator keeps reading one plain config.
if (flags.style) {
  const comfyUrl = process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188";
  const { styles, speedLora } = await resolveStyles(comfyUrl);
  const style = styles.find((entry) => entry.id === String(flags.style));
  if (!style) {
    throw new Error(
      `Unknown image style "${flags.style}". Available: ${styles.map((s) => s.id).join(", ")}.`,
    );
  }
  if (!style.available) {
    throw new Error(`Image style "${style.id}" is unavailable: ${style.reason}`);
  }
  config.imageGen = applyStyle(config.imageGen ?? {}, style, {
    fast: flags.fast === true,
    speedLora,
  });
  // A video's override is deliberately applied after the provider preset. This makes it local
  // to this project; it cannot leak into future videos unless the user explicitly promotes it.
  config.imageGen.styleSuffix = effectivePromptProfile.stylePrompt;
  config.imageGen.compactStyleSuffix = effectivePromptProfile.compactStylePrompt ?? null;
  // The look supplies negatives about medium and rendering; the topic supplies negatives about
  // cast. Joining them here is what lets one look serve any topic.
  config.imageGen.negativeExtra = [
    effectivePromptProfile.negativePrompt,
    topic.negatives,
    castAge?.negatives,
    topic.cast?.age?.safetyNegatives,
  ]
    .filter((part) => part && part.trim())
    .map((part) => part.replaceAll("{{age}}", castAge?.descriptor ?? ""))
    .join(", ");
  const bits = [style.label, style.checkpoint].filter(Boolean);
  if (config.imageGen.loras?.length) {
    bits.push(`loras: ${config.imageGen.loras.map((lora) => lora.name).join(", ")}`);
  }
  bits.push(`${config.imageGen.steps} steps`);
  console.log(`Style: ${bits.join(" · ")}.`);
  if (style.note) console.log(`Note: ${style.note}`);
}

// The real duration is only known once Voicebox has spoken the lines; compose-slideshow
// rewrites this from the measured timings. This estimate keeps video.json coherent until then.
config.duration = Number((estimated + tail).toFixed(2));
await writeJson(configPath, config);

console.log(`${lines.length} line(s), ~${totalWords} words, estimated ${estimated.toFixed(1)}s spoken.`);
for (const [index, line] of lines.entries()) {
  console.log(`${String(index + 1).padStart(2)}. (${line.split(/\s+/).length}w) ${line}`);
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}
