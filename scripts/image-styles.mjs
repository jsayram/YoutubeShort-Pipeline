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
  // A style whose prompt profile has been deleted is reported as broken rather than thrown on.
  // Retiring one style must not take the whole catalogue down with it — otherwise Studio cannot
  // list *any* provider and the only way back is to hand-repair JSON.
  return styles.map((style) => {
    const profileId = style.promptProfile ?? style.id;
    const profile = profiles[profileId];
    if (!profile) {
      return {
        ...style,
        promptProfile: profileId,
        sceneTemplate: "",
        stylePrompt: "",
        negativeExtra: "",
        broken: true,
        reason: `Prompt profile "${profileId}" is missing from templates/prompt.json.`,
      };
    }
    return {
      ...style,
      promptProfile: profileId,
      sceneTemplate: profile.sceneTemplate,
      stylePrompt: profile.stylePrompt,
      compactStylePrompt: profile.compactStylePrompt ?? null,
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
  const [loras, diffusionModels, textEncoders, vaes] = await Promise.all([
    fetchList("LoraLoader", "lora_name"),
    fetchList("UNETLoader", "unet_name"),
    fetchList("CLIPLoader", "clip_name"),
    fetchList("VAELoader", "vae_name"),
  ]);
  return {
    checkpoints,
    loras: loras ?? [],
    diffusionModels: diffusionModels ?? [],
    textEncoders: textEncoders ?? [],
    vaes: vaes ?? [],
  };
}

export async function drawThingsStatus(
  baseUrl = process.env.DRAWTHINGS_BASE_URL ?? "http://127.0.0.1:7860",
) {
  const sharedSecret = process.env.DRAWTHINGS_SHARED_SECRET;
  const response = await fetch(baseUrl.replace(/\/$/, ""), {
    headers: sharedSecret ? { Authorization: `Bearer ${sharedSecret}` } : {},
    signal: AbortSignal.timeout(3_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

// Fragments are a priority list, not a set: `["animagine", "illustrious"]` means "animagine if it
// is installed, otherwise illustrious". Iterate fragments rather than files, because iterating
// files makes the winner depend on whatever order ComfyUI happens to list its directory in — so
// merely installing a new checkpoint could silently repoint an existing style at a different model.
function firstMatch(files, fragments) {
  for (const piece of (fragments ?? []).filter(Boolean)) {
    const hit = files.find((file) => file.toLowerCase().includes(piece.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

// Step-reduction LoRAs are orthogonal to style: they make any preset faster without changing
// what it looks like. Detected once and offered as a toggle rather than baked into a preset.
const SPEED_FRAGMENTS = ["lightning", "hyper", "dmd2", "lcm", "turbo"];
const SPEED_SAMPLING = { steps: 6, cfg: 1.6, sampler: "euler", scheduler: "sgm_uniform" };

export async function resolveStyles(baseUrl) {
  const styles = await loadStyles();
  const [models, drawThings] = await Promise.all([
    comfyModels(baseUrl),
    drawThingsStatus(),
  ]);
  const speedLora = models ? firstMatch(models.loras, SPEED_FRAGMENTS) : null;

  const resolved = styles.map((style) => {
    // A style missing its prompt profile can never render; surface it as unavailable with the
    // reason instead of letting it look selectable.
    if (style.broken) {
      return { ...style, available: false, checkpoint: null, loras: [] };
    }

    if (style.provider === "cloudflare-flux2") {
      const configured = Boolean(
        process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN,
      );
      return {
        ...style,
        available: configured,
        reason: configured
          ? null
          : "Cloudflare credentials are not configured in .env.",
        checkpoint: null,
        loras: [],
      };
    }

    if (style.provider === "pixazo-sdxl") {
      const configured = Boolean(process.env.PIXAZO_API ?? process.env.PIXAZO_API_KEY);
      return {
        ...style,
        available: configured,
        reason: configured ? null : "PIXAZO_API is not configured in .env.",
        checkpoint: null,
        loras: [],
      };
    }

    if (style.provider === "drawthings") {
      if (!drawThings) {
        return {
          ...style,
          available: false,
          reason: "Draw Things is not reachable. Open the app and enable its HTTP API server.",
          checkpoint: null,
          loras: style.loras ?? [],
        };
      }
      const requiredModel = String(style.drawThingsModel ?? "");
      const activeModel = String(drawThings.model ?? "");
      const modelReady = !requiredModel || activeModel === requiredModel;
      return {
        ...style,
        available: modelReady,
        reason: modelReady
          ? null
          : `Draw Things currently has "${activeModel || "no model"}" selected; choose "${requiredModel}".`,
        checkpoint: null,
        loras: style.loras ?? [],
        activeModel,
      };
    }

    if (style.provider === "flux2-local") {
      const required = style.requiredModels ?? {};
      const fallbackReady = Boolean(
        style.fallbackProvider === "cloudflare-flux2" &&
          process.env.CLOUDFLARE_ACCOUNT_ID &&
          process.env.CLOUDFLARE_API_TOKEN,
      );
      if (!models) {
        return {
          ...style,
          available: fallbackReady,
          degraded: fallbackReady,
          reason: fallbackReady ? null : "ComfyUI is not reachable.",
          note: fallbackReady
            ? "ComfyUI is offline; this run will use the configured Cloudflare fallback."
            : null,
          checkpoint: null,
          loras: [],
        };
      }
      const diffusionModel = firstMatch(models.diffusionModels, [required.diffusionModel]);
      const textEncoder = firstMatch(models.textEncoders, [required.textEncoder]);
      const vae = firstMatch(models.vaes, [required.vae]);
      const missing = [
        !diffusionModel && required.diffusionModel,
        !textEncoder && required.textEncoder,
        !vae && required.vae,
      ].filter(Boolean);
      return {
        ...style,
        available: missing.length === 0 || fallbackReady,
        degraded: missing.length > 0 && fallbackReady,
        reason:
          missing.length > 0 && !fallbackReady
            ? `Missing local FLUX model file(s): ${missing.join(", ")}.`
            : null,
        note:
          missing.length > 0 && fallbackReady
            ? `Local FLUX is missing ${missing.join(", ")}; Cloudflare will be used.`
            : null,
        diffusionModel,
        textEncoder,
        vae,
        checkpoint: null,
        loras: [],
      };
    }

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
  // A visual provider may opt into a matching automatic composition. Clear the field when a
  // different provider is selected so switching back to the original storybook style restores
  // the ordinary slideshow instead of inheriting the living treatment.
  next.compositionPreset = style.compositionPreset ?? null;
  // Each of these belongs to one provider's model family (FLUX.2's diffusionModel/textEncoder/vae
  // vs comfyui's checkpoint). Assign unconditionally so switching, say, FLUX.2 -> Animagine clears
  // the old fields instead of leaving them in imageGen for the new provider to misread — ComfyUI's
  // VAELoader does not care whose preset asked for it, it just loads whatever is still there.
  next.checkpoint = style.checkpoint ?? null;
  next.diffusionModel = style.diffusionModel ?? null;
  next.textEncoder = style.textEncoder ?? null;
  next.vae = style.vae ?? null;
  next.fallbackProvider = style.fallbackProvider ?? null;
  next.drawThingsModel = style.drawThingsModel ?? null;
  Object.assign(next, style.sampling ?? {});
  // Some looks are not 16:9. The storybook preset paints square art that the composition
  // centres over a blurred enlargement of itself, so it must not be cropped to the frame.
  Object.assign(next, style.framing ?? {});
  next.styleSuffix = style.stylePrompt;
  next.compactStyleSuffix = style.compactStylePrompt ?? null;
  next.negativeExtra = style.negativeExtra ?? "";
  // Deterministic finishing belongs to the preset too. Clear it when switching away from a
  // treated style so a later photographic run does not inherit ink edge extraction.
  next.postProcess = style.postProcess ?? null;
  next.loras = [...(style.loras ?? [])];
  next.referencePrompts = (style.referencePrompts ?? []).map((reference) => ({
    ...reference,
  }));

  if (fast && speedLora) {
    next.loras.push({ name: speedLora, strength: 1 });
    Object.assign(next, SPEED_SAMPLING);
  }
  return next;
}
