import path from "node:path";
import { readJson, repoRoot } from "./lib.mjs";

// Style presets describe a look, not a specific file. Model filenames vary by where you
// downloaded them, so a preset lists name fragments to match against whatever ComfyUI actually
// has. That way a preset either resolves to a real installed checkpoint or reports honestly
// that it needs a download, instead of failing at generation time with a missing-model error.

export async function loadStyles() {
  const [styles, prompts] = await Promise.all([
    readJson(path.join(repoRoot, "templates", "image-styles.json")),
    readJson(path.join(repoRoot, "templates", "prompt.json")),
  ]);
  const profiles = prompts.providers ?? {};
  return styles.map((style) => {
    const profileId = style.promptProfile ?? style.id;
    const profile = profiles[profileId];
    if (!profile) {
      throw new Error(
        `Image style "${style.id}" references missing prompt profile "${profileId}".`,
      );
    }
    return {
      ...style,
      promptProfile: profileId,
      sceneTemplate: profile.sceneTemplate,
      stylePrompt: profile.stylePrompt,
      negativeExtra: profile.negativePrompt ?? "",
    };
  });
}

export async function loadPromptProfiles() {
  const document = await readJson(path.join(repoRoot, "templates", "prompt.json"));
  return document.providers ?? {};
}

export async function comfyModels(baseUrl) {
  const url = baseUrl.replace(/\/$/, "");
  const fetchList = async (nodeClass, field) => {
    const response = await fetch(`${url}/object_info/${nodeClass}`).catch(() => null);
    if (!response?.ok) return null;
    const info = await response.json().catch(() => null);
    const list = info?.[nodeClass]?.input?.required?.[field]?.[0];
    return Array.isArray(list) ? list : [];
  };

  const checkpoints = await fetchList("CheckpointLoaderSimple", "ckpt_name");
  if (checkpoints === null) return null;
  const loras = (await fetchList("LoraLoader", "lora_name")) ?? [];
  return { checkpoints, loras };
}

function firstMatch(files, fragments) {
  if (!fragments?.length) return null;
  return (
    files.find((file) => fragments.some((piece) => file.toLowerCase().includes(piece))) ?? null
  );
}

// Step-reduction LoRAs are orthogonal to style: they make any preset faster without changing
// what it looks like. Detected once and offered as a toggle rather than baked into a preset.
const SPEED_FRAGMENTS = ["lightning", "hyper", "dmd2", "lcm", "turbo"];
const SPEED_SAMPLING = { steps: 6, cfg: 1.6, sampler: "euler", scheduler: "sgm_uniform" };

export async function resolveStyles(baseUrl) {
  const styles = await loadStyles();
  const models = await comfyModels(baseUrl);
  const speedLora = models ? firstMatch(models.loras, SPEED_FRAGMENTS) : null;

  const resolved = styles.map((style) => {
    if (style.provider !== "comfyui") {
      // Cloud providers do not depend on local models, so availability is about credentials,
      // which the generator checks when it runs.
      return { ...style, available: true, checkpoint: null, loras: [] };
    }
    if (!models) {
      return { ...style, available: false, reason: "ComfyUI is not reachable.", loras: [] };
    }

    // Preferred checkpoints win over merely-compatible ones. Without this, resolution takes
    // whatever the directory lists first, so an illustration style would keep binding to a
    // photorealism model that happened to sort earlier.
    const checkpoint =
      firstMatch(models.checkpoints, style.prefersCheckpoint) ??
      firstMatch(models.checkpoints, style.match);
    if (!checkpoint) {
      return {
        ...style,
        available: false,
        reason: "No matching checkpoint installed.",
        loras: [],
      };
    }

    const styleLora = firstMatch(models.loras, style.requiresLora);

    // Running is not the same as looking right. A photorealism checkpoint will happily accept a
    // flat-vector prompt and hand back a photograph, so say plainly when the only installed
    // model cannot reach the style. Tested: RealVisXL under the ink-line prompt returns a
    // high-contrast photo, not linework.
    const preferred = style.prefersCheckpoint
      ? Boolean(firstMatch([checkpoint], style.prefersCheckpoint))
      : true;
    const notes = [];
    if (style.requiresLora && !styleLora) notes.push("no style LoRA installed");
    if (!preferred && !styleLora) notes.push("only a photorealism checkpoint is installed");

    return {
      ...style,
      available: true,
      degraded: notes.length > 0,
      checkpoint,
      loras: styleLora ? [{ name: styleLora, strength: 0.85 }] : [],
      note: notes.length
        ? `Expect photographic results: ${notes.join(" and ")}. ${style.download ?? ""}`.trim()
        : undefined,
    };
  });

  return { styles: resolved, speedLora, speedSampling: SPEED_SAMPLING };
}

// Flattens a resolved style into the imageGen block the generator already reads, so the CLI and
// the studio stay on one code path.
export function applyStyle(imageGen, style, { fast = false, speedLora = null } = {}) {
  const next = { ...imageGen, provider: style.provider, style: style.id };
  if (style.checkpoint) next.checkpoint = style.checkpoint;
  Object.assign(next, style.sampling ?? {});
  // Some looks are not 9:16. The storybook preset paints square art that the composition
  // centres over a blurred enlargement of itself, so it must not be cropped to the frame.
  Object.assign(next, style.framing ?? {});
  next.styleSuffix = style.stylePrompt;
  next.negativeExtra = style.negativeExtra ?? "";
  // Deterministic finishing belongs to the preset too. Clear it when switching away from a
  // treated style so a later photographic run does not inherit ink edge extraction.
  next.postProcess = style.postProcess ?? null;
  next.loras = [...(style.loras ?? [])];

  if (fast && speedLora) {
    next.loras.push({ name: speedLora, strength: 1 });
    Object.assign(next, SPEED_SAMPLING);
  }
  return next;
}
