import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  commandOutput,
  makeWordlessVisualPrompt,
  run,
  scrubTextNouns,
  splitNegations,
  stripQuotedText,
  writeJson,
} from "./lib.mjs";
import {
  listJobs,
  providerOutcomeIsUncertain,
  transitionJob,
} from "./generation-jobs.mjs";

// FLUX's ComfyUI workflow zeroes out its "negative" conditioning (ConditioningZeroOut) rather
// than encoding real negative text, and both local and Cloudflare FLUX.2 run at guidance 1, where
// classifier-free guidance collapses to the positive prediction alone. So a profile's
// negativePrompt field, and anything phrased as a negation in the positive text, never reaches
// the model here — unlike comfyui/SDXL's real CFG negative or Gemini's own hard-requirement
// string. FLUX also renders text unusually well, so a narration line that reads like dialogue
// (quoted lyrics, a spoken line) tempts it into drawing a literal speech bubble or comic panel
// instead of an illustration. This has to be stated as a positive instruction FLUX actually reads.
const FLUX_NO_TEXT_REQUIREMENT =
  "Hard requirement: this is one single silent illustrated scene with no readable text, letters, " +
  "numbers, captions, dialogue, or speech bubbles anywhere in it, and it is not a comic strip or " +
  "multi-panel layout. Every surface that could carry writing is left blank. The artwork is unsigned " +
  "and unbranded; both lower corners contain only uninterrupted paint or paper texture.";
const FLUX_OBJECT_ONLY_REQUIREMENT =
  "Composition requirement: an object-only still life in an unoccupied setting. The narration-named " +
  "prop and its immediate environment are the only subjects.";

export async function beginAuthorizedRemoteImage(slug, provider, item, index) {
  const job = await matchingImageJob(slug, provider, item, index, "authorized");
  if (!job) {
    throw new Error(
      `${provider} scene ${Number(index) + 1} has no fresh cost authorization. ` +
        "Open Studio and confirm this provider request.",
    );
  }
  await transitionJob(slug, job.id, "submitted");
  await transitionJob(slug, job.id, "running");
  return job;
}

export async function skipAuthorizedRemoteImage(slug, provider, item, index, artifact) {
  const job = await matchingImageJob(slug, provider, item, index, "authorized");
  if (!job) return null;
  return transitionJob(slug, job.id, "cancelled", {
    actual: { unit: "provider request", amount: 0 },
    artifact,
    error: { message: "No provider request was sent because the existing artifact was reused." },
  });
}

async function matchingImageJob(slug, provider, item, index, status) {
  return (await listJobs(slug)).find(
    (entry) =>
      entry.kind === "image-scene" &&
      entry.provider === provider &&
      (
        (entry.item?.sceneId && entry.item.sceneId === item.id) ||
        (!entry.item?.sceneId && Number(entry.item?.index) === Number(index))
      ) &&
      entry.status === status,
  );
}

export async function finishRemoteImage(slug, job, result = {}) {
  return transitionJob(slug, job.id, "succeeded", {
    providerRequestId: result.providerRequestId ?? null,
    actual: result.actual ?? { unit: "provider request", amount: 1 },
    artifact: result.artifact ?? null,
  });
}

export async function failRemoteImage(slug, job, error, { uncertain = false } = {}) {
  if (!job) return;
  return transitionJob(
    slug,
    job.id,
    uncertain || providerOutcomeIsUncertain(error) ? "unknown" : "failed",
    {
    error: { message: String(error?.message ?? error) },
    },
  );
}

export function styleForScene(item, styleSuffix = "") {
  if (String(item.castMode ?? "") !== "object") return styleSuffix;
  // A look may describe how recurring figures are simplified. Those tokens are useful in people
  // scenes but become a direct request for people in a still life, especially for anime-tuned
  // checkpoints. Keep the paper/ink/palette contract and drop only figure-specific clauses.
  return String(styleSuffix)
    .split(",")
    .filter((term) => !/\b(?:figure|human|anatomy|facial|silhouette)\w*\b/i.test(term))
    .join(",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildFluxPrompt(item, styleSuffix) {
  const source = splitNegations(stripQuotedText(makeWordlessVisualPrompt(item.prompt)));
  const style = splitNegations(styleForScene(item, styleSuffix));
  const cleaned = scrubTextNouns([source.positive, style.positive].filter(Boolean).join(". "));
  return [
    cleaned,
    String(item.castMode ?? "") === "object" ? FLUX_OBJECT_ONLY_REQUIREMENT : "",
    FLUX_NO_TEXT_REQUIREMENT,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildGeminiPrompt(item, styleSuffix) {
  return buildFluxPrompt(item, styleSuffix);
}

// The salt defaults to 0 so a plain re-run still reproduces the same image. Forced
// regeneration passes a fresh random salt (see resolveSeedSalt) so the hash lands elsewhere.
export function seedFor(id, salt = 0) {
  const text = salt ? `${id}:${salt}` : id;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 2 ** 31;
}

// --force normally only bypasses the "already generated" skip check, which reproduces the
// exact same image when the prompt hasn't changed too, since the seed is a stable hash of the
// scene id. Pass an explicit --seed-salt to reproduce a specific forced batch; otherwise each
// forced run gets its own random salt so it actually renders something new.
export function resolveSeedSalt(flags, forced) {
  if (!forced) return 0;
  if (flags["seed-salt"] !== undefined) return Number(flags["seed-salt"]);
  return Math.floor(Math.random() * 2 ** 31);
}

export function splitImageItems(prompts, imageGen) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error("content/image-prompts.json must contain at least one prompt.");
  }

  const references = [];
  const seen = new Set();
  for (const item of [
    ...(Array.isArray(imageGen.referencePrompts) ? imageGen.referencePrompts : []),
    ...prompts.filter((item) => item.kind === "reference"),
  ]) {
    const id = String(item.id ?? "").trim();
    const prompt = String(item.prompt ?? "").trim();
    if (!id || !prompt || seen.has(id)) continue;
    seen.add(id);
    references.push({
      ...item,
      id,
      prompt,
      kind: "reference",
      role: item.role ?? "style",
    });
  }

  const scenes = prompts.filter((item) => item.kind !== "reference");
  return { references, scenes };
}

export async function installGenerationLock(projectDir, project) {
  const lockPath = path.join(projectDir, ".image-generation.lock");
  let ownsLock = false;

  function processIsAlive(pid) {
    if (!Number.isInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify(
          {
            pid: process.pid,
            project,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      await handle.close();
      ownsLock = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = await fs
        .readFile(lockPath, "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (processIsAlive(Number(owner?.pid))) {
        throw new Error(
          `Images for "${project}" are already being generated by process ${owner.pid}.`,
        );
      }
      await fs.rm(lockPath, { force: true });
    }
  }

  if (!ownsLock) throw new Error(`Could not reserve image generation for "${project}".`);

  const release = () => {
    if (!ownsLock) return;
    ownsLock = false;
    try {
      fsSync.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  process.once("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      release();
      process.kill(process.pid, signal);
    });
  }
  return release;
}

export function promptWithReferences(prompt, references) {
  if (!references.length) return prompt;
  const directions = references.map((reference, index) => {
    const number = index + 1;
    return reference.role === "character"
      ? `Use reference image ${number} only for the recurring character's identity, hair, clothing, proportions, and palette; do not copy its pose or background`
      : `Use reference image ${number} only for the medium, brush texture, lighting language, and color palette; do not copy its layout or subject matter`;
  });
  return `${prompt}\n\nReference directions: ${directions.join(
    ". ",
  )}. Preserve identity and medium while changing the pose, action, camera, props, location, and composition to match this scene.`;
}

export function referencesForScene(scene, references) {
  const castMode = String(scene.castMode ?? "");
  const eligible = references.filter(
    (reference) =>
      !Array.isArray(reference.appliesTo) ||
      reference.appliesTo.map(String).includes(castMode),
  );
  if (Array.isArray(scene.references)) {
    if (!scene.references.length) return [];
    const wanted = new Set(scene.references.map(String));
    return eligible.filter((reference) => wanted.has(reference.id));
  }

  const characters = eligible.filter((reference) => reference.role === "character");
  if (["none", "object"].includes(castMode)) {
    return eligible.filter((reference) => reference.role !== "character");
  }
  if (characters.length < 2 || !/^solo-[ab]$/.test(castMode)) {
    return eligible;
  }
  const chosen = castMode === "solo-a" ? characters[0] : characters[1];
  return [
    chosen,
    ...eligible.filter((reference) => reference.role !== "character"),
  ];
}

// Post-processing looks applied after scale/crop, keyed by imageGen.postProcess. Grain is a
// deterministic overlay rather than something a diffusion model reproduces consistently on its
// own: the reference clips this was matched against carry the same grain and vignette across
// completely different scenes, which only a fixed filter pass (not model noise) explains.
const POST_PROCESS_FILTERS = {
  // Light paper grain and a soft vignette, no forced color curve: the mood-driven sky gradient
  // is the prompt's job, and a fixed duotone push here would fight scenes that want a cool tone.
  "paper-grain": "noise=alls=14:allf=t+u,vignette=PI/5,eq=saturation=0.92:contrast=1.03",
};
const COMPLEX_POST_PROCESSES = new Set(["acrylic-unsigned"]);

export async function writeExactImage({
  bytes,
  finalPath,
  outWidth,
  outHeight,
  fit = "cover",
  postProcess = null,
}) {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const temporary = `${finalPath}.${process.pid}.source`;
  await fs.writeFile(temporary, bytes);
  const crop =
    fit === "contain"
      ? `scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2:color=0x111014`
      : `scale=${outWidth}:${outHeight}:force_original_aspect_ratio=increase,crop=${outWidth}:${outHeight}`;
  const postFilter = postProcess ? POST_PROCESS_FILTERS[postProcess] : null;
  const complexPostProcess = COMPLEX_POST_PROCESSES.has(postProcess);
  if (postProcess && !postFilter && !complexPostProcess) {
    throw new Error(
      `Unknown postProcess "${postProcess}". Use one of: ${[
        ...Object.keys(POST_PROCESS_FILTERS),
        ...COMPLEX_POST_PROCESSES,
      ].join(", ")}.`,
    );
  }
  const filter = postFilter ? `${crop},${postFilter}` : crop;
  try {
    const filterArgs = complexPostProcess
      ? [
          "-filter_complex",
          `[0:v]${crop},split[base][patch];` +
            "[patch]crop=115:100:760:1765,hflip[clean];" +
            "[base][clean]overlay=890:1765,noise=alls=8:allf=t+u[out]",
          "-map",
          "[out]",
        ]
      : ["-vf", filter];
    await run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      temporary,
      ...filterArgs,
      "-frames:v",
      "1",
      finalPath,
    ]);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function finishImageRun({
  projectDir,
  scenes,
  allScenes = scenes,
  manifest,
  outWidth,
  outHeight,
  partial = false,
}) {
  const outputDir = path.join(projectDir, "public", "generated");
  let finalManifest = manifest;
  if (partial) {
    const previous = await fs
      .readFile(path.join(outputDir, "manifest.json"), "utf8")
      .then(JSON.parse)
      .catch(() => []);
    const updates = new Map(manifest.map((entry) => [entry.id, entry]));
    finalManifest = previous.map((entry) => updates.get(entry.id) ?? entry);
    for (const entry of manifest) {
      if (!previous.some((previousEntry) => previousEntry.id === entry.id)) {
        finalManifest.push(entry);
      }
    }
  }
  await writeJson(path.join(outputDir, "manifest.json"), finalManifest);

  const currentSceneFiles = new Set(allScenes.map((item) => `${item.id}.png`));
  let staleRemoved = 0;
  for (const entry of partial ? [] : await fs.readdir(outputDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /\.(?:png|jpe?g|webp)$/i.test(entry.name) &&
      !currentSceneFiles.has(entry.name)
    ) {
      await fs.rm(path.join(outputDir, entry.name), { force: true });
      staleRemoved += 1;
    }
  }
  if (staleRemoved) console.log(`Removed ${staleRemoved} stale generated image(s).`);

  for (const entry of finalManifest) {
    const file = path.join(projectDir, entry.file);
    const size = await commandOutput("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ]);
    if (size.trim() !== `${outWidth},${outHeight}`) {
      throw new Error(`${entry.file} is ${size.trim()}, expected ${outWidth},${outHeight}.`);
    }
  }
  console.log(`All scene images verified at ${outWidth}x${outHeight}.`);
  return finalManifest;
}
