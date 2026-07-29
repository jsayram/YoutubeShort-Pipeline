import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadEnv,
  commandOutput,
  parseArgs,
  readJson,
  repoRoot,
  resolveHyperframesVersion,
  run,
  videoDir,
  writeJson,
} from "./lib.mjs";
import { loadStyles, resolveStyles } from "./image-styles.mjs";
import { DEFAULT_TOPIC_ID, loadTopics } from "./topics.mjs";
import {
  listPromptBackups,
  promoteProviderDefault,
  promptEditorState,
  regenerateProjectScenePrompts,
  resetProjectPromptOverride,
  restoreProviderDefault,
  saveProjectPromptOverride,
  saveScenePrompts,
} from "./prompt-profiles.mjs";
import { resolveVoiceboxEngine } from "./voicebox-profile.mjs";
import { localLlmStatus } from "./local-llm.mjs";
import {
  editNarrationLine,
  generateNarrationTake,
  loadNarrationReview,
  saveReviewContinuation,
  selectNarrationTake,
  validateReview,
} from "./narration-review.mjs";
import {
  approveImage,
  approveImageReview,
  loadImageReview,
  prepareImageReview,
  regenerateImageTake,
  selectImageTake,
  validateImageReview,
} from "./image-review.mjs";

await loadEnv();

// A local control room for the pipeline. Paste a script, watch every stage run top to bottom,
// see each still as it lands, and play the finished file at the bottom. It drives the same
// scripts the CLI does — no second code path into the pipeline, so anything that works here
// works from a terminal and vice versa.

const { flags } = parseArgs();
const port = Number(flags.port ?? process.env.STUDIO_PORT ?? 4300);
const studioDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "studio");
const videosRoot = path.join(repoRoot, "videos");
const studioStatePath = path.join(videosRoot, ".studio-state.json");
// One place to change when a style is retired. These ids were previously inlined at four call
// sites, so deleting the style they named silently broke Studio.
const DEFAULTS = { style: "flux2-storybook", promptStyle: "photographic", topic: DEFAULT_TOPIC_ID };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
};

// ---------------------------------------------------------------------------- run state

/** @type {{id:string, slug:string, stages:any[], events:any[], child:any, done:boolean}|null} */
let current = null;
const listeners = new Set();
let persistStateChain = Promise.resolve();
let imageReviewActions = 0;

function savedRunState() {
  if (!current) return null;
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    run: {
      id: current.id,
      slug: current.slug,
      stages: current.stages,
      events: current.events,
      done: current.done,
    },
  };
}

function persistCurrent() {
  const snapshot = savedRunState();
  if (!snapshot) return persistStateChain;
  persistStateChain = persistStateChain
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(videosRoot, { recursive: true });
      await writeJson(studioStatePath, snapshot);
    });
  return persistStateChain;
}

async function restoreCurrent() {
  const saved = await readJson(studioStatePath).catch(() => null);
  if (!saved?.run?.id || !saved.run.slug || !Array.isArray(saved.run.events)) return;
  current = {
    id: String(saved.run.id),
    slug: String(saved.run.slug),
    stages: Array.isArray(saved.run.stages) ? saved.run.stages : [],
    events: saved.run.events,
    child: null,
    done: saved.run.done !== false,
  };
  // A Studio process cannot resume a child process after a service restart. Preserve everything
  // that was visible, but mark an unfinished stage as interrupted instead of pretending it is
  // still running. Saved images remain discoverable through /api/project-assets.
  if (!current.done) {
    for (const stage of current.stages) {
      if (stage.status === "running") stage.status = "interrupted";
    }
    current.done = true;
    current.events.push({
      type: "error",
      message: "Studio restarted while this run was active. Saved progress was restored.",
      at: Date.now(),
    });
    await persistCurrent();
  }
}

function stopStageChild(signal = "SIGTERM") {
  const child = current?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return false;
  try {
    // Every stage gets its own process group. Stopping the dispatcher therefore also stops the
    // ComfyUI worker it launched, instead of orphaning that worker and starting a duplicate on
    // the next Studio run.
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function emit(event) {
  if (!current) return;
  const payload = { ...event, at: Date.now() };
  current.events.push(payload);
  void persistCurrent();
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of listeners) response.write(frame);
}

function setStage(id, status, detail) {
  if (!current) return;
  const stage = current.stages.find((entry) => entry.id === id);
  if (stage) {
    stage.status = status;
    if (detail !== undefined) stage.detail = detail;
  }
  emit({ type: "stage", id, status, detail });
}

// Runs one child process, streaming its output as log events attached to a stage.
function runStage(id, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    setStage(id, "running");
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    if (current) current.child = child;

    let buffered = "";
    const consume = (chunk) => {
      buffered += chunk;
      let index;
      while ((index = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, index).replace(/\r$/, "");
        buffered = buffered.slice(index + 1);
        emit({ type: "log", stage: id, line });
        options.onLine?.(line);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (buffered.trim()) emit({ type: "log", stage: id, line: buffered.trim() });
      if (current?.child === child) current.child = null;
      if (code === 0) {
        setStage(id, "done");
        resolve();
      } else if (signal) {
        setStage(id, "cancelled");
        reject(new Error(`${id} was cancelled`));
      } else {
        setStage(id, "failed");
        reject(new Error(`${id} exited with code ${code}`));
      }
    });
  });
}

const node = process.execPath;
const script = (name) => path.join(repoRoot, "scripts", name);

function stageList(options) {
  const stages = [
    { id: "doctor", label: "Environment check", status: "pending" },
    { id: "scaffold", label: "Project", status: "pending" },
    { id: "script", label: "Script and prompts", status: "pending" },
    { id: "voice", label: "Narration", status: "pending" },
    { id: "review", label: "Narration review", status: "pending" },
    { id: "images", label: "Images", status: "pending" },
    { id: "image-review", label: "Image review", status: "pending" },
    { id: "compose", label: "Composition", status: "pending" },
    { id: "check", label: "Validation", status: "pending" },
  ];
  if (options.captions) {
    stages.splice(7, 0, { id: "captions", label: "Caption timing", status: "pending" });
  }
  if (options.render) stages.push({ id: "render", label: "Render", status: "pending" });
  return stages;
}

async function startRun({ slug, title, scriptText, options }) {
  const projectDir = videoDir(slug);
  const exists = await fs.access(projectDir).then(() => true, () => false);
  const gapMs = Math.max(0, Math.min(10000, Math.round(Number(options.gapMs ?? 3000))));

  current = {
    id: String(Date.now()),
    slug,
    stages: stageList(options),
    events: [],
    child: null,
    done: false,
  };

  const runId = current.id;
  emit({ type: "run", runId, slug, stages: current.stages });

  try {
    if (options.doctor === false) setStage("doctor", "skipped");
    else await runStage("doctor", node, [script("doctor.mjs")]);

    if (exists) {
      setStage("scaffold", "done", `Reusing videos/${slug}`);
      emit({ type: "log", stage: "scaffold", line: `Reusing existing project videos/${slug}` });
    } else {
      await runStage("scaffold", node, [script("new-video.mjs"), slug]);
    }

    const scriptFile = path.join(projectDir, "content", ".studio-script.txt");
    await fs.mkdir(path.dirname(scriptFile), { recursive: true });
    await fs.writeFile(scriptFile, scriptText);
    const prepareArgs = [script("prepare-script.mjs"), "--project", slug, "--script", scriptFile];
    if (title) prepareArgs.push("--title", title);
    if (options.keepPrompts) prepareArgs.push("--keep-prompts");
    prepareArgs.push("--gap", String(gapMs));
    prepareArgs.push("--captions", String(options.captions === true));
    // Persist the chosen voice into video.json so the project keeps it, and so a later CLI run
    // speaks in the same voice as the one started from here.
    if (options.profile) {
      prepareArgs.push("--profile", options.profile);
      const voices = (await listVoices()) ?? [];
      const chosen = voices.find((voice) => voice.name === options.profile);
      if (chosen?.engine) prepareArgs.push("--engine", chosen.engine);
    }
    if (options.topic) prepareArgs.push("--topic", options.topic);
    if (options.style) {
      prepareArgs.push("--style", options.style);
      if (options.fast) prepareArgs.push("--fast");
    }
    await runStage("script", node, prepareArgs);
    await fs.rm(scriptFile, { force: true });
    const preparedConfigPath = path.join(projectDir, "video.json");
    const preparedConfig = await readJson(preparedConfigPath);
    preparedConfig.imageGen ??= {};
    preparedConfig.imageGen.enrichWithLLM = options.enrichWithLLM !== false;
    preparedConfig.imageGen.reviewBeforeComposition = true;
    preparedConfig.voicebox ??= {};
    preparedConfig.voicebox.reviewBeforeImages = options.reviewNarration !== false;
    await writeJson(preparedConfigPath, preparedConfig);
    await emitPrompts(slug);

    if (options.skipVoice) setStage("voice", "skipped");
    else {
      const voiceArgs = [
        script("narration-review-cli.mjs"),
        "prepare",
        "--project",
        slug,
      ];
      if (options.reviewNarration === false) voiceArgs.push("--auto-approve");
      await runStage("voice", node, voiceArgs);
      if (options.reviewNarration !== false) {
        setStage("review", "waiting", "Choose a take for every line, then approve narration.");
        const review = await saveReviewContinuation(slug, options);
        emit({ type: "narration-review", slug, review: publicReviewState(slug, review) });
        emit({ type: "paused", reason: "narration-review", slug });
        return;
      }
      setStage("review", "skipped");
      await emitTiming(slug);
    }

    const paused = await finishPipeline(slug, options);
    if (!paused) emit({ type: "done", slug });
  } catch (error) {
    if (!current?.resetting) {
      emit({ type: "error", message: String(error.message ?? error) });
    }
  } finally {
    if (current) {
      current.done = true;
      void persistCurrent();
    }
  }
}

async function finishPipeline(slug, options) {
    const projectDir = videoDir(slug);
    if (options.skipImages) {
      setStage("images", "skipped");
      setStage("image-review", "skipped");
    }
    else {
      const imageArgs = [script("generate-images.mjs"), "--project", slug];
      if (options.force) imageArgs.push("--force");
      await runStage("images", node, imageArgs, {
        onLine: (line) => {
          const match = line.match(/^\[(\d+)\/(\d+)\]\s+(\S+)\s+[—-]/);
          if (match) void emitImage(slug, match[3], Number(match[1]), Number(match[2]));
        },
      });
      await emitImages(slug);
      const review = await prepareImageReview(slug, options);
      setStage(
        "image-review",
        "waiting",
        "Approve every image, then continue to composition.",
      );
      emit({ type: "image-review", slug, review: publicImageReviewState(slug, review) });
      emit({ type: "paused", reason: "image-review", slug });
      return true;
    }

    await finishPostImagePipeline(slug, options);
    return false;
}

async function finishPostImagePipeline(slug, options) {
    const projectDir = videoDir(slug);
    if (options.captions) {
      await runStage("captions", node, [script("align-words.mjs"), "--project", slug]);
    }

    // The selected content provider may own a matching motion treatment. The dispatcher reads
    // the saved video.json, so Studio and the command line always choose the same composer.
    const composeArgs = [script("compose-video.mjs"), "--project", slug];
    if (options.forceCompose) composeArgs.push("--force");
    await runStage("compose", node, composeArgs);

    const configPath = path.join(projectDir, "video.json");
    const config = await readJson(configPath);
    const hyperframesVersion = await resolveHyperframesVersion(config);
    if (config.hyperframesVersion !== hyperframesVersion) {
      config.hyperframesVersion = hyperframesVersion;
      await writeJson(configPath, config);
      emit({
        type: "log",
        stage: "check",
        line: `Repaired missing HyperFrames version: ${hyperframesVersion}.`,
      });
    }
    await runStage(
      "check",
      "npx",
      ["--yes", `hyperframes@${hyperframesVersion}`, "check"],
      { cwd: projectDir },
    );

    if (options.render) {
      await runStage("render", node, [
        script("render-video.mjs"),
        "--project",
        slug,
        "--approved",
      ]);
      await emitVideo(slug);
    }

}

async function resumeAfterNarrationReview(slug, options) {
  current = {
    id: String(Date.now()),
    slug,
    stages: [
      { id: "review", label: "Assemble narration", status: "pending" },
      { id: "images", label: "Images", status: "pending" },
      { id: "image-review", label: "Image review", status: "pending" },
      ...(options.captions
        ? [{ id: "captions", label: "Caption timing", status: "pending" }]
        : []),
      { id: "compose", label: "Composition", status: "pending" },
      { id: "check", label: "Validation", status: "pending" },
      ...(options.render ? [{ id: "render", label: "Render", status: "pending" }] : []),
    ],
    events: [],
    child: null,
    done: false,
  };
  emit({ type: "run", runId: current.id, slug, stages: current.stages });
  try {
    // Approving narration starts a fresh continuation run and rebuilds the stage DOM in Studio.
    // Re-emit the prompts so that continuation has an image grid to receive live thumbnails.
    // Without this, image events were delivered correctly but had no cells to update.
    await emitPrompts(slug);
    await runStage("review", node, [
      script("narration-review-cli.mjs"),
      "approve",
      "--project",
      slug,
    ]);
    await emitTiming(slug);
    const paused = await finishPipeline(slug, options);
    if (!paused) emit({ type: "done", slug });
  } catch (error) {
    emit({ type: "error", message: String(error.message ?? error) });
  } finally {
    if (current) {
      current.done = true;
      void persistCurrent();
    }
  }
}

async function resumeAfterImageReview(slug, options) {
  current = {
    id: String(Date.now()),
    slug,
    stages: [
      { id: "image-review", label: "Image approval", status: "pending" },
      ...(options.captions
        ? [{ id: "captions", label: "Caption timing", status: "pending" }]
        : []),
      { id: "compose", label: "Composition", status: "pending" },
      { id: "check", label: "Validation", status: "pending" },
      ...(options.render ? [{ id: "render", label: "Render", status: "pending" }] : []),
    ],
    events: [],
    child: null,
    done: false,
  };
  emit({ type: "run", runId: current.id, slug, stages: current.stages });
  try {
    const state = await loadImageReview(slug);
    if (!state || state.status !== "approved") {
      throw new Error("Image approval was not saved before continuation.");
    }
    setStage("image-review", "done", `${state.lines.length} images approved`);
    await emitImages(slug);
    await finishPostImagePipeline(slug, options);
    emit({ type: "done", slug });
  } catch (error) {
    emit({ type: "error", message: String(error.message ?? error) });
  } finally {
    if (current) {
      current.done = true;
      void persistCurrent();
    }
  }
}

function publicReviewState(slug, state) {
  if (!state) return null;
  return {
    ...state,
    settings: {
      profile: state.settings?.profile,
      engine: state.settings?.engine,
      modelSize: state.settings?.modelSize,
      language: state.settings?.language,
      gapMs: state.settings?.gapMs,
    },
    lines: state.lines.map((line) => ({
      ...line,
      takes: line.takes.map((take) => ({
        ...take,
        audioUrl: `/${["media", slug, ...take.audio.split("/")].map(encodeURIComponent).join("/")}`,
      })),
    })),
    validation: validateReview(state),
  };
}

function publicImageReviewState(slug, state) {
  if (!state) return null;
  return {
    ...state,
    lines: state.lines.map((line) => ({
      ...line,
      takes: line.takes.map((take) => ({
        ...take,
        imageUrl: `/${["media", slug, ...take.image.split("/")].map(encodeURIComponent).join("/")}?v=${encodeURIComponent(take.id)}`,
      })),
    })),
    validation: validateImageReview(state),
  };
}

// Render on its own, for a project whose media is already built.
async function startRender(slug) {
  current = {
    id: String(Date.now()),
    slug,
    stages: [{ id: "render", label: "Render", status: "pending" }],
    events: [],
    child: null,
    done: false,
  };
  emit({ type: "run", runId: current.id, slug, stages: current.stages });
  try {
    await runStage("render", node, [script("render-video.mjs"), "--project", slug, "--approved"]);
    await emitVideo(slug);
    emit({ type: "done", slug });
  } catch (error) {
    emit({ type: "error", message: String(error.message ?? error) });
  } finally {
    if (current) {
      current.done = true;
      void persistCurrent();
    }
  }
}

// ---------------------------------------------------------------------------- artifact events

async function emitPrompts(slug) {
  const prompts = await readJson(
    path.join(videoDir(slug), "content", "image-prompts.json"),
  ).catch(() => null);
  const narration = await fs
    .readFile(path.join(videoDir(slug), "content", "narration.txt"), "utf8")
    .catch(() => "");
  if (prompts) {
    emit({
      type: "prompts",
      prompts,
      lines: narration.split(/\r?\n/).filter((line) => line.trim()),
    });
  }
}

async function findGenerated(slug, id) {
  const dir = path.join(videoDir(slug), "public", "generated");
  for (const extension of ["png", "jpg", "jpeg", "webp"]) {
    const file = `${id}.${extension}`;
    const found = await fs.access(path.join(dir, file)).then(() => file, () => null);
    if (found) return found;
  }
  return null;
}

async function emitImage(slug, id, index, total) {
  const file = await findGenerated(slug, id);
  if (!file) return;
  emit({
    type: "image",
    id,
    index,
    total,
    url: `/media/${slug}/public/generated/${file}?v=${Date.now()}`,
  });
}

async function emitImages(slug) {
  const manifest = await readJson(
    path.join(videoDir(slug), "public", "generated", "manifest.json"),
  ).catch(() => []);
  for (const [index, entry] of manifest.entries()) {
    await emitImage(slug, entry.id, index + 1, manifest.length);
  }
}

async function emitTiming(slug) {
  const timing = await readJson(
    path.join(videoDir(slug), "public", "audio", "narration.timing.json"),
  ).catch(() => null);
  if (!timing) return;
  emit({
    type: "audio",
    url: `/media/${slug}/public/audio/narration.wav?v=${Date.now()}`,
    spokenDuration: timing.spokenDuration,
    pauseMs: timing.pauseMs ?? timing.gapMs ?? 0,
    lines: timing.lines ?? [],
  });
}

async function emitVideo(slug) {
  const file = path.join(videoDir(slug), "renders", `${slug}.mp4`);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return;
  const delivery = await readJson(
    path.join(videoDir(slug), "renders", `${slug}.delivery.json`),
  ).catch(() => null);
  emit({
    type: "video",
    url: `/media/${slug}/renders/${slug}.mp4?v=${Date.now()}`,
    bytes: stat.size,
    deliveryPath: delivery?.deliveredFile ?? null,
  });
}

// ---------------------------------------------------------------------------- voicebox

const voiceboxUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
const voiceboxPort = Number(new URL(voiceboxUrl).port || 17493);
let serviceResetPromise = null;

// Voicebox is the authority on which voices exist, so the picker reads them live rather than
// keeping its own list that can drift out of date.
async function listVoices() {
  const response = await fetch(`${voiceboxUrl}/profiles`).catch(() => null);
  if (!response?.ok) return null;
  const profiles = await response.json().catch(() => null);
  if (!Array.isArray(profiles)) return null;
  return profiles.map((profile) => {
    const resolved = resolveVoiceboxEngine(profile, null);
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description ?? "",
      language: profile.language ?? "",
      cloned: profile.voice_type === "cloned",
      // A profile type determines the engine family. Always return a usable engine so choosing
      // a clone cannot inherit the previous preset voice's qwen_custom_voice setting.
      engine: resolved.engine,
      generations: profile.generation_count ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------- image styles

const comfyUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");

async function fetchJson(url, timeoutMs = 1800) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function serviceSnapshot() {
  const [comfyStats, comfyQueue, voiceHealth, localLlm, template] =
    await Promise.all([
    fetchJson(`${comfyUrl}/system_stats`),
    fetchJson(`${comfyUrl}/queue`),
    fetchJson(`${voiceboxUrl}/health`),
    localLlmStatus(),
    readJson(path.join(repoRoot, "templates", "video.json")).catch(() => null),
    ]);

  const device = comfyStats?.devices?.[0] ?? null;
  const runningJobs = comfyQueue?.queue_running?.length ?? 0;
  const pendingJobs = comfyQueue?.queue_pending?.length ?? 0;
  const comfyRunning = Boolean(comfyStats);
  const voiceRunning = voiceHealth?.status === "healthy";

  return {
    checkedAt: Date.now(),
    resetting: Boolean(serviceResetPromise),
    services: [
      {
        id: "studio",
        name: "Pipeline Studio",
        status: "running",
        kind: "service",
        detail: `This control room · port ${port}`,
        url: `http://127.0.0.1:${port}`,
        action: "Current page",
      },
      {
        id: "comfyui",
        name: "ComfyUI",
        status: serviceResetPromise
          ? "restarting"
          : comfyRunning
            ? (runningJobs ? "busy" : "running")
            : "offline",
        kind: "service",
        detail: comfyRunning
          ? [
              `v${comfyStats.system?.comfyui_version ?? "unknown"}`,
              device?.name ? `${device.name.toUpperCase()} device` : null,
              `${runningJobs} running`,
              `${pendingJobs} queued`,
            ]
              .filter(Boolean)
              .join(" · ")
          : `Not reachable at ${comfyUrl}`,
        url: comfyUrl,
        action: "Open ComfyUI",
      },
      {
        id: "voicebox",
        name: "Voicebox",
        status: serviceResetPromise ? "restarting" : voiceRunning ? "running" : "offline",
        kind: "application",
        detail: voiceRunning
          ? [
              voiceHealth.model_size ? `${voiceHealth.model_size} model` : null,
              voiceHealth.backend_type?.toUpperCase(),
              voiceHealth.gpu_type,
            ]
              .filter(Boolean)
              .join(" · ")
          : `Not reachable at ${voiceboxUrl}`,
        url: null,
        // The action is most useful when the app is *not* running, so it is always offered.
        // `open -a` launches a closed app and foregrounds an already-running one, which covers
        // both the "it is not started" and "I closed the window" cases.
        action: voiceRunning ? "Open Voicebox" : "Launch Voicebox",
      },
      {
        id: "local-llm",
        name: `${localLlm.name} prompt director`,
        status: localLlm.reachable && localLlm.modelReady ? "running" : "offline",
        kind: "service",
        detail: localLlm.reachable
          ? localLlm.modelReady
            ? `${localLlm.model} ready · optional scene enrichment`
            : `${localLlm.name} is running, but ${localLlm.model} is unavailable`
          : `Not reachable at ${localLlm.baseUrl}`,
        url: null,
        action: null,
      },
      {
        id: "hyperframes",
        name: "HyperFrames",
        status: "ready",
        kind: "tool",
        detail: `CLI ${template?.hyperframesVersion ?? "configured"} · runs on demand`,
        url: null,
        action: null,
      },
    ],
  };
}

async function waitForJson(url, predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fetchJson(url, 1200);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function listenerPids(portNumber) {
  const output = await commandOutput("lsof", [
    "-tiTCP:" + String(portNumber),
    "-sTCP:LISTEN",
  ]).catch(() => "");
  return output
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
}

async function exactProcessPids(name) {
  const output = await commandOutput("pgrep", ["-x", name]).catch(() => "");
  return output
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
}

async function waitForNoProcesses(name, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await exactProcessPids(name)).length) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function waitForNoListener(portNumber, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await listenerPids(portNumber)).length) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function waitForVoiceboxStable(timeoutMs = 120000) {
  const startedAt = Date.now();
  let consecutive = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const [health, profiles] = await Promise.all([
      fetchJson(`${voiceboxUrl}/health`, 1800),
      fetchJson(`${voiceboxUrl}/profiles`, 1800),
    ]);
    if (health?.status === "healthy" && Array.isArray(profiles)) {
      consecutive += 1;
      // A single health response can arrive before the profile/model layer is truly settled.
      // Three complete checks make "ready" mean the app stayed ready, not merely opened a port.
      if (consecutive >= 3) return { health, profiles };
    } else {
      consecutive = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

async function restartComfyUi() {
  // First ask ComfyUI to abandon both the active prompt and anything queued. This also prevents
  // a just-cancelled Studio worker from leaving a job that immediately starts after the restart.
  await Promise.all([
    fetch(`${comfyUrl}/interrupt`, { method: "POST" }).catch(() => null),
    fetch(`${comfyUrl}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    }).catch(() => null),
  ]);

  for (const pid of await listenerPids(8188)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await waitForJson(`${comfyUrl}/system_stats`, (value) => !value, 8000);

  const comfyRoot = path.resolve(
    String(process.env.COMFYUI_ROOT ?? path.join(process.env.HOME ?? "", "ComfyUI")),
  );
  const mainFile = path.join(comfyRoot, "main.py");
  const configuredPython = process.env.COMFYUI_PYTHON;
  const venvPython = path.join(comfyRoot, "venv", "bin", "python");
  const python =
    configuredPython ||
    ((await fs.access(venvPython).then(() => true, () => false)) ? venvPython : "python3");
  const exists = await fs.access(mainFile).then(() => true, () => false);
  if (!exists) throw new Error(`Cannot restart ComfyUI because ${mainFile} does not exist.`);

  const child = spawn(
    python,
    [
      mainFile,
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
      "--enable-cors-header",
      `http://127.0.0.1:${port}`,
    ],
    { cwd: comfyRoot, detached: true, stdio: "ignore" },
  );
  child.unref();
  const ready = await waitForJson(`${comfyUrl}/system_stats`, Boolean, 60000);
  if (!ready) throw new Error("ComfyUI did not become ready after restarting.");
}

async function restartVoicebox() {
  await run("osascript", ["-e", 'tell application "Voicebox" to quit'], {
    stdio: "ignore",
  }).catch(() => {});

  // The API often disappears before the application process has finished quitting. Relaunching
  // in that gap merely focuses the dying process and leaves the Voicebox window open with no
  // server on port 17493. Wait for a real process exit, then escalate only if the app is stuck.
  if (!(await waitForNoProcesses("voicebox", 15000))) {
    for (const pid of await exactProcessPids("voicebox")) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  if (!(await waitForNoProcesses("voicebox", 8000))) {
    for (const pid of await exactProcessPids("voicebox")) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  if (!(await waitForNoProcesses("voicebox", 3000))) {
    throw new Error("The previous Voicebox process would not close.");
  }

  // Voicebox's server is a separate process and can outlive the app window. A surviving listener
  // would make the newly opened app look healthy while it is actually talking to an orphan from
  // the prior session, or prevent the new server from binding at all.
  for (const pid of await listenerPids(voiceboxPort)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (!(await waitForNoListener(voiceboxPort, 8000))) {
    for (const pid of await listenerPids(voiceboxPort)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  if (!(await waitForNoListener(voiceboxPort, 3000))) {
    throw new Error(`The previous Voicebox server would not release port ${voiceboxPort}.`);
  }

  await run("open", ["-na", "Voicebox"], { stdio: "ignore" });
  const stable = await waitForVoiceboxStable();
  if (!stable) {
    throw new Error(
      "Voicebox opened but its health and profile APIs did not remain stable after restarting.",
    );
  }
}

async function cancelRunForReset() {
  const child = current?.child;
  const cancelled = stopStageChild();
  if (current && !current.done) {
    current.resetting = true;
    current.done = true;
    emit({ type: "reset", message: "Pipeline cancelled for a full service restart." });
  }
  if (cancelled && child) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  return cancelled;
}

async function resetAllServices() {
  const cancelledRun = await cancelRunForReset();
  // This is the one explicit destructive UI action. Ordinary browser reloads preserve and replay
  // history; Restart everything deliberately starts the control room from a clean slate.
  await persistStateChain.catch(() => {});
  current = null;
  await fs.rm(studioStatePath, { force: true });
  const results = await Promise.allSettled([restartComfyUi(), restartVoicebox()]);
  const failures = results
    .map((result, index) =>
      result.status === "rejected"
        ? `${index === 0 ? "ComfyUI" : "Voicebox"}: ${result.reason?.message ?? result.reason}`
        : null,
    )
    .filter(Boolean);
  return {
    cancelledRun,
    restarted: {
      comfyui: results[0].status === "fulfilled",
      voicebox: results[1].status === "fulfilled",
    },
    failures,
  };
}

function beginServiceReset() {
  if (serviceResetPromise) return serviceResetPromise;
  serviceResetPromise = resetAllServices().finally(() => {
    serviceResetPromise = null;
  });
  return serviceResetPromise;
}

// ---------------------------------------------------------------------------- http

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  response.end(text);
}

function validSlug(slug) {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

async function promptProfileIdFor(styleId) {
  const styles = await loadStyles();
  const style = styles.find((entry) => entry.id === styleId);
  if (!style) throw new Error(`Unknown content provider "${styleId}".`);
  return style.promptProfile ?? style.id;
}

function rejectPromptWriteWhileRunning(response) {
  if (!current || current.done) return false;
  sendJson(response, 409, {
    error: "Wait for the current pipeline run to finish before changing prompts.",
  });
  return true;
}

// The spoken script of a project. content/narration.txt is what the pipeline writes and what
// Voicebox reads, so it is the authoritative copy; the studio's own scratch file is ignored.
async function readNarration(projectPath) {
  const text = await fs
    .readFile(path.join(projectPath, "content", "narration.txt"), "utf8")
    .catch(() => "");
  return text.trim();
}

// A browser cannot hand back an absolute directory path — file inputs deliberately hide it. The
// studio server runs on the same machine as the browser, so it can open the real macOS folder
// chooser instead and return a genuine POSIX path.
function pickFolder(startAt) {
  return new Promise((resolve) => {
    const script = [
      'set startFolder to POSIX file "' + String(startAt ?? process.env.HOME ?? "/").replace(/"/g, "") + '"',
      'set chosen to choose folder with prompt "Select a video project folder" default location startFolder',
      "POSIX path of chosen",
    ];
    const child = spawn("osascript", script.flatMap((line) => ["-e", line]), {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    // The dialog is modal on the user's desktop; if it is never answered the request would hang
    // forever without this.
    const timer = setTimeout(() => child.kill("SIGTERM"), 120000);

    child.once("error", () => {
      clearTimeout(timer);
      resolve({ error: "Could not open the folder chooser on this system." });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        // choose folder returns a trailing slash; the import path comparison wants it bare.
        resolve({ path: stdout.trim().replace(/\/$/, "") });
      } else if (/user canceled/i.test(stderr)) {
        resolve({ cancelled: true });
      } else {
        resolve({ error: stderr.trim() || "The folder chooser was closed." });
      }
    });
  });
}

// Walks a directory adding up file sizes, giving up as soon as it passes the budget so a huge
// tree costs a partial walk rather than a full one. node_modules and .git are excluded because
// the copy skips them too.
async function directorySizeMb(root, budgetMb) {
  const budgetBytes = budgetMb * 1024 * 1024;
  let bytes = 0;
  const queue = [root];
  while (queue.length) {
    const dir = queue.pop();
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        bytes += stat?.size ?? 0;
        if (bytes > budgetBytes) return budgetMb + 1;
      }
    }
  }
  return bytes / (1024 * 1024);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Serves one file, honouring Range so the rendered MP4 is seekable in the player.
async function sendFile(request, response, filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  const type = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
      return;
    }
    response.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const route = url.pathname;

  try {
    if (route === "/" || route === "/index.html") {
      await sendFile(request, response, path.join(studioDir, "index.html"));
      return;
    }

    if (route === "/api/projects") {
      const entries = await fs.readdir(videosRoot, { withFileTypes: true }).catch(() => []);
      const projects = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const config = await readJson(path.join(videosRoot, entry.name, "video.json")).catch(
          () => null,
        );
        if (!config) continue;
        const rendered = await fs
          .access(path.join(videosRoot, entry.name, "renders", `${entry.name}.mp4`))
          .then(() => true, () => false);
        projects.push({
          slug: entry.name,
          title: config.title,
          duration: config.duration,
          rendered,
          captionsEnabled: config.captions?.enabled === true,
          reviewNarration: config.voicebox?.reviewBeforeImages !== false,
          voiceProfile: config.voicebox?.profile ?? null,
          pauseSeconds: Number(config.voicebox?.gapMs ?? 3000) / 1000,
          enrichWithLLM: config.imageGen?.enrichWithLLM === true,
          styleId: config.imageGen?.style ?? null,
          topicId: config.topic ?? null,
          script: await readNarration(path.join(videosRoot, entry.name)),
        });
      }
      sendJson(response, 200, { projects });
      return;
    }

    // Bring an existing project directory under videos/ so the studio can drive it. Copies
    // rather than symlinks: the HyperFrames CLI, npx and the media server all resolve real
    // paths, and a symlink pointing outside the tree would also defeat the /media path guard.
    if (route === "/api/pick-folder" && request.method === "POST") {
      const body = await readBody(request).catch(() => ({}));
      const result = await pickFolder(body.startAt || videosRoot);
      sendJson(response, result.error ? 500 : 200, result);
      return;
    }

    if (route === "/api/import" && request.method === "POST") {
      const body = await readBody(request);
      const source = path.resolve(String(body.path ?? "").replace(/^~/, process.env.HOME ?? "~"));
      const stat = await fs.stat(source).catch(() => null);
      if (!stat?.isDirectory()) {
        sendJson(response, 400, { error: `Not a directory: ${source}` });
        return;
      }

      // A bare index.html is not enough to call something a project — plenty of ordinary
      // folders have one, and treating a downloads folder as importable copies gigabytes of
      // unrelated files. Require a marker only this pipeline or HyperFrames writes.
      const has = async (name) =>
        fs.access(path.join(source, name)).then(() => true, () => false);
      const hasComposition = await has("index.html");
      const config = await readJson(path.join(source, "video.json")).catch(() => null);
      const marker = config || (await has("hyperframes.json")) || (await has("meta.json"));
      if (!marker) {
        sendJson(response, 400, {
          error:
            "That folder has no video.json, hyperframes.json or meta.json, so it is not a " +
            "video project. An index.html on its own is not enough.",
        });
        return;
      }

      // Second guard: even a real project can sit inside something enormous. Refuse to copy a
      // surprising amount of data without being told to.
      const budgetMb = Number(body.maxMb ?? 4096);
      const totalMb = await directorySizeMb(source, budgetMb);
      if (totalMb > budgetMb) {
        sendJson(response, 400, {
          error: `That folder is over ${budgetMb} MB. Pass a larger maxMb if the copy is intended.`,
        });
        return;
      }

      const slug = String(body.slug || path.basename(source))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        sendJson(response, 400, { error: `Cannot derive a usable slug from "${source}".` });
        return;
      }

      const destination = path.join(videosRoot, slug);
      // Pointing at a folder already under videos/ is a select, not a copy.
      if (source === destination) {
        sendJson(response, 200, {
          slug,
          alreadyHere: true,
          title: config?.title ?? slug,
          hasComposition,
          script: await readNarration(source),
          captionsEnabled: config?.captions?.enabled === true,
          reviewNarration: config?.voicebox?.reviewBeforeImages !== false,
          enrichWithLLM: config?.imageGen?.enrichWithLLM === true,
          styleId: config?.imageGen?.style ?? null,
          topicId: config?.topic ?? null,
        });
        return;
      }
      const taken = await fs.access(destination).then(() => true, () => false);
      if (taken && !body.overwrite) {
        sendJson(response, 409, { error: `videos/${slug} already exists.`, slug });
        return;
      }

      // node_modules is regenerable and can dwarf the project itself.
      await fs.cp(source, destination, {
        recursive: true,
        force: true,
        filter: (entry) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(entry),
      });

      // A copied project keeps the old project's identity otherwise, and the render step names
      // its output from the slug.
      const meta = { id: slug, name: slug };
      await fs.writeFile(
        path.join(destination, "meta.json"),
        `${JSON.stringify(meta, null, 2)}\n`,
      );

      const imported = await readJson(path.join(destination, "video.json")).catch(() => null);
      sendJson(response, 200, {
        slug,
        title: imported?.title ?? slug,
        hasComposition,
        from: source,
        captionsEnabled: imported?.captions?.enabled === true,
        reviewNarration: imported?.voicebox?.reviewBeforeImages !== false,
        enrichWithLLM: imported?.imageGen?.enrichWithLLM === true,
        styleId: imported?.imageGen?.style ?? null,
        topicId: imported?.topic ?? null,
        // Hand the project's narration back so the script box shows what this video actually
        // says, rather than leaving the previous project's text sitting there.
        script: await readNarration(destination),
      });
      return;
    }

    if (route === "/api/voices") {
      const voices = await listVoices();
      if (!voices) {
        sendJson(response, 200, {
          voices: [],
          error: `Voicebox is not reachable at ${voiceboxUrl}. Start the app and reload.`,
        });
        return;
      }
      const template = await readJson(path.join(repoRoot, "templates", "video.json")).catch(
        () => null,
      );
      sendJson(response, 200, { voices, default: template?.voicebox?.profile ?? null });
      return;
    }

    if (route === "/api/providers") {
      const { styles, speedLora, speedSampling } = await resolveStyles(comfyUrl);
      sendJson(response, 200, {
        styles: styles.map((style) => ({
          id: style.id,
          label: style.label,
          summary: style.summary,
          provider: style.provider,
          available: style.available,
          degraded: Boolean(style.degraded),
          reason: style.reason ?? null,
          note: style.note ?? null,
          checkpoint: style.checkpoint ?? null,
          diffusionModel: style.diffusionModel ?? null,
          textEncoder: style.textEncoder ?? null,
          vae: style.vae ?? null,
          fallbackProvider: style.fallbackProvider ?? null,
          referenceCount: style.referencePrompts?.length ?? 0,
          promptProfile: style.promptProfile,
          compositionPreset: style.compositionPreset ?? null,
          loras: (style.loras ?? []).map((lora) => lora.name),
          download: style.download ?? null,
        })),
        speedLora,
        speedSampling,
        default: DEFAULTS.style,
      });
      return;
    }

    if (route === "/api/topics") {
      const topics = await loadTopics();
      sendJson(response, 200, {
        topics: topics.map((topic) => ({
          id: topic.id,
          label: topic.label,
          summary: topic.summary ?? null,
          hasCast: (topic.cast?.mode ?? "none") !== "none",
        })),
        default: DEFAULTS.topic,
      });
      return;
    }

    if (route === "/api/prompt-editor" && request.method === "GET") {
      const slug = String(url.searchParams.get("slug") ?? "").trim();
      const styleId = String(url.searchParams.get("style") ?? DEFAULTS.promptStyle).trim();
      if (slug && !validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const profileId = await promptProfileIdFor(styleId);
      sendJson(response, 200, await promptEditorState({ slug: slug || null, profileId }));
      return;
    }

    if (route === "/api/prompt-editor/project" && request.method === "PUT") {
      if (rejectPromptWriteWhileRunning(response)) return;
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const projectPath = videoDir(slug);
      const exists = await fs.access(projectPath).then(() => true, () => false);
      if (!exists) {
        // Saving an override before the first run is a normal workflow. Scaffold only the empty
        // project shell; the later Run action still writes narration and generates every asset.
        await run(node, [script("new-video.mjs"), slug]);
      }
      const profileId = await promptProfileIdFor(String(body.style ?? ""));
      const saved = await saveProjectPromptOverride({
        profileId,
        projectPath,
        values: body.values,
      });
      sendJson(response, 200, {
        saved,
        scope: "video",
        createdProject: !exists,
        message:
          `Saved only for videos/${slug}. Future videos are unchanged.` +
          (!exists ? " Created its empty project shell for the first run." : ""),
      });
      return;
    }

    if (route === "/api/prompt-editor/project/reset" && request.method === "POST") {
      if (rejectPromptWriteWhileRunning(response)) return;
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const profileId = await promptProfileIdFor(String(body.style ?? ""));
      const removed = await resetProjectPromptOverride({
        profileId,
        projectPath: videoDir(slug),
      });
      sendJson(response, 200, {
        removed,
        scope: "video",
        message: "This video now inherits the provider default.",
      });
      return;
    }

    if (route === "/api/prompt-editor/scenes" && request.method === "PUT") {
      if (rejectPromptWriteWhileRunning(response)) return;
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const projectPath = videoDir(slug);
      const exists = await fs.access(projectPath).then(() => true, () => false);
      if (!exists) {
        sendJson(response, 404, { error: "Create or import this video before saving scenes." });
        return;
      }
      const profileId = await promptProfileIdFor(String(body.style ?? ""));
      const saved = await saveScenePrompts({
        profileId,
        projectPath,
        scenes: body.scenes,
        editedSceneIds: body.editedSceneIds,
      });
      sendJson(response, 200, {
        ...saved,
        message: `Saved ${saved.editedSceneIds.length} edited scene prompt(s) for this video.`,
      });
      return;
    }

    if (route === "/api/prompt-editor/scenes/regenerate" && request.method === "POST") {
      if (rejectPromptWriteWhileRunning(response)) return;
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const projectPath = videoDir(slug);
      const exists = await fs.access(projectPath).then(() => true, () => false);
      if (!exists) {
        sendJson(response, 404, { error: "Create or import this video before regenerating scenes." });
        return;
      }
      const profileId = await promptProfileIdFor(String(body.style ?? ""));
      const result = await regenerateProjectScenePrompts({
        profileId,
        projectPath,
        preserveEdited: body.preserveEdited !== false,
      });
      sendJson(response, 200, {
        ...result,
        message: body.preserveEdited === false
          ? `Regenerated all ${result.scenes.length} scene prompts.`
          : `Regenerated untouched scenes and preserved ${result.editedSceneIds.length} edit(s).`,
      });
      return;
    }

    if (route === "/api/prompt-editor/default/promote" && request.method === "POST") {
      if (rejectPromptWriteWhileRunning(response)) return;
      const body = await readBody(request);
      const profileId = await promptProfileIdFor(String(body.style ?? ""));
      const result = await promoteProviderDefault({
        profileId,
        values: body.values,
        confirmation: body.confirmation,
      });
      sendJson(response, 200, {
        backup: path.basename(result.backupPath),
        message:
          "Provider default changed for future videos. Existing video overrides and saved scene prompts were not changed.",
      });
      return;
    }

    if (route === "/api/prompt-editor/default/restore" && request.method === "POST") {
      if (rejectPromptWriteWhileRunning(response)) return;
      const body = await readBody(request);
      const profileId = await promptProfileIdFor(String(body.style ?? ""));
      const result = await restoreProviderDefault({
        profileId,
        backupName: String(body.backup ?? ""),
        confirmation: body.confirmation,
      });
      sendJson(response, 200, {
        safetyBackup: path.basename(result.safetyPath),
        message:
          "Provider default restored for future videos. Existing video overrides and scenes were not changed.",
      });
      return;
    }

    if (route === "/api/prompt-editor/default/backups" && request.method === "GET") {
      const styleId = String(url.searchParams.get("style") ?? DEFAULTS.promptStyle).trim();
      const profileId = await promptProfileIdFor(styleId);
      const backups = await listPromptBackups({ profileId });
      sendJson(response, 200, { backups: backups.map(({ name }) => name) });
      return;
    }

    if (route === "/api/services") {
      sendJson(response, 200, await serviceSnapshot());
      return;
    }

    if (route === "/api/services/reset" && request.method === "POST") {
      // This endpoint is intentionally explicit and heavyweight. The ordinary status button only
      // rereads health; this one cancels work and restarts both local model applications.
      const result = await beginServiceReset();
      result.snapshot = await serviceSnapshot();
      sendJson(response, result.failures.length ? 503 : 200, result);
      return;
    }

    if (route === "/api/services/voicebox/open" && request.method === "POST") {
      try {
        await run("open", ["-a", "Voicebox"], { stdio: "ignore" });
      } catch {
        sendJson(response, 500, {
          error: "Could not launch Voicebox. Is it installed in /Applications?",
        });
        return;
      }

      // Launching is not the same as being ready: the server takes a few seconds to bind and
      // load its model. Poll briefly so the UI can report the real state instead of flipping to
      // "running" the instant the app icon appears.
      let ready = false;
      for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
        const health = await fetchJson(`${voiceboxUrl}/health`);
        ready = health?.status === "healthy";
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      sendJson(response, 200, { opened: true, ready });
      return;
    }

    if (route === "/api/project-assets") {
      const slug = String(url.searchParams.get("slug") ?? "").trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        sendJson(response, 400, { error: "Bad slug." });
        return;
      }

      const prompts = await readJson(
        path.join(videoDir(slug), "content", "image-prompts.json"),
      ).catch(() => []);
      const projectConfig = await readJson(
        path.join(videoDir(slug), "video.json"),
      ).catch(() => ({}));
      const images = [];
      for (const prompt of Array.isArray(prompts) ? prompts : []) {
        const file = await findGenerated(slug, prompt.id);
        images.push({
          id: prompt.id,
          ready: Boolean(file),
          url: file ? `/media/${slug}/public/generated/${file}?v=${Date.now()}` : null,
        });
      }
      const references = [];
      for (const reference of projectConfig.imageGen?.referencePrompts ?? []) {
        const id = String(reference.id ?? "").trim();
        if (!id) continue;
        const relative = `assets/references/${id}.png`;
        const absolute = path.join(videoDir(slug), relative);
        const ready = await fs.access(absolute).then(() => true, () => false);
        references.push({
          id,
          role: reference.role ?? "reference",
          ready,
          url: ready ? `/media/${slug}/${relative}?v=${Date.now()}` : null,
        });
      }
      sendJson(response, 200, {
        slug,
        total: images.length,
        generated: images.filter((image) => image.ready).length,
        images,
        references,
      });
      return;
    }

    if (route === "/api/narration-review" && request.method === "GET") {
      const slug = String(url.searchParams.get("slug") ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await loadNarrationReview(slug);
      if (!state) {
        sendJson(response, 404, { error: "This project has no narration review yet." });
        return;
      }
      sendJson(response, 200, { review: publicReviewState(slug, state) });
      return;
    }

    if (route === "/api/image-review" && request.method === "GET") {
      const slug = String(url.searchParams.get("slug") ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await loadImageReview(slug);
      if (!state) {
        sendJson(response, 404, { error: "This project has no image review yet." });
        return;
      }
      sendJson(response, 200, { review: publicImageReviewState(slug, state) });
      return;
    }

    if (route === "/api/image-review/regenerate" && request.method === "POST") {
      if ((current && !current.done) || imageReviewActions > 0) {
        sendJson(response, 409, { error: "A pipeline stage is already running." });
        return;
      }
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      imageReviewActions += 1;
      try {
        const state = await regenerateImageTake(
          slug,
          Number(body.lineIndex),
          body.prompt,
        );
        sendJson(response, 200, { review: publicImageReviewState(slug, state) });
      } catch (error) {
        const state = await loadImageReview(slug);
        sendJson(response, 500, {
          error: String(error.message ?? error),
          review: publicImageReviewState(slug, state),
        });
      } finally {
        imageReviewActions -= 1;
      }
      return;
    }

    if (route === "/api/image-review/select" && request.method === "POST") {
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await selectImageTake(
        slug,
        Number(body.lineIndex),
        String(body.takeId ?? ""),
      );
      sendJson(response, 200, { review: publicImageReviewState(slug, state) });
      return;
    }

    if (route === "/api/image-review/approve-image" && request.method === "POST") {
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await approveImage(slug, Number(body.lineIndex));
      sendJson(response, 200, { review: publicImageReviewState(slug, state) });
      return;
    }

    if (route === "/api/image-review/continue" && request.method === "POST") {
      if ((current && !current.done) || imageReviewActions > 0) {
        sendJson(response, 409, { error: "A pipeline stage is already running." });
        return;
      }
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await loadImageReview(slug);
      const validation = validateImageReview(state);
      if (!validation.valid) {
        sendJson(response, 400, { error: validation.errors.join(" ") });
        return;
      }
      const approved = await approveImageReview(slug);
      sendJson(response, 200, { started: true });
      void resumeAfterImageReview(slug, approved.studioOptions ?? {});
      return;
    }

    if (route === "/api/narration-review/line" && request.method === "PUT") {
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      await editNarrationLine(slug, Number(body.lineIndex), body.text);
      const result = await generateNarrationTake(slug, Number(body.lineIndex));
      sendJson(response, 200, { review: publicReviewState(slug, result.state) });
      return;
    }

    if (route === "/api/narration-review/regenerate" && request.method === "POST") {
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const result = await generateNarrationTake(slug, Number(body.lineIndex));
      sendJson(response, 200, { review: publicReviewState(slug, result.state) });
      return;
    }

    if (route === "/api/narration-review/select" && request.method === "POST") {
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await selectNarrationTake(
        slug,
        Number(body.lineIndex),
        String(body.takeId ?? ""),
      );
      sendJson(response, 200, { review: publicReviewState(slug, state) });
      return;
    }

    if (route === "/api/narration-review/approve" && request.method === "POST") {
      if (current && !current.done) {
        sendJson(response, 409, { error: "A pipeline stage is already running." });
        return;
      }
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!validSlug(slug)) {
        sendJson(response, 400, { error: "Bad project slug." });
        return;
      }
      const state = await loadNarrationReview(slug);
      const validation = validateReview(state);
      if (!validation.valid) {
        sendJson(response, 400, { error: validation.errors.join(" ") });
        return;
      }
      sendJson(response, 200, { started: true });
      void resumeAfterNarrationReview(slug, state.studioOptions ?? {});
      return;
    }

    if (route === "/api/state") {
      sendJson(response, 200, {
        busy: Boolean(current && !current.done),
        imageReviewBusy: imageReviewActions > 0,
        resetting: Boolean(serviceResetPromise),
        run: current
          ? { id: current.id, slug: current.slug, stages: current.stages, done: current.done }
          : null,
      });
      return;
    }

    if (route === "/api/run" && request.method === "POST") {
      if ((current && !current.done) || imageReviewActions > 0) {
        sendJson(response, 409, { error: "A run is already in progress." });
        return;
      }
      if (serviceResetPromise) {
        sendJson(response, 409, {
          error: "Local services are still restarting. Wait for Voicebox and ComfyUI to be ready.",
        });
        return;
      }
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      const scriptText = String(body.script ?? "").trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        sendJson(response, 400, { error: "Slug must be lowercase letters, numbers, and hyphens." });
        return;
      }
      if (!scriptText) {
        sendJson(response, 400, { error: "Paste a script first." });
        return;
      }
      // Opening the app window does not prove its model server is ready. Wait briefly for a
      // manually launched Voicebox, and never begin the environment check in the half-started
      // state that previously produced a false "Voicebox is not reachable" failure.
      const voicebox = await waitForVoiceboxStable(45000);
      if (!voicebox) {
        sendJson(response, 503, {
          error:
            "Voicebox is open but not ready. Use Restart everything and wait until its status says running.",
        });
        return;
      }
      sendJson(response, 200, { started: true });
      void startRun({
        slug,
        title: body.title ? String(body.title) : "",
        scriptText,
        options: body.options ?? {},
      });
      return;
    }

    if (route === "/api/render" && request.method === "POST") {
      if (current && !current.done) {
        sendJson(response, 409, { error: "A run is already in progress." });
        return;
      }
      const body = await readBody(request);
      const slug = String(body.slug ?? "").trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        sendJson(response, 400, { error: "Bad slug." });
        return;
      }
      sendJson(response, 200, { started: true });
      void startRender(slug);
      return;
    }

    if (route === "/api/cancel" && request.method === "POST") {
      sendJson(response, 200, { cancelled: stopStageChild() });
      return;
    }

    if (route === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write("retry: 2000\n\n");
      // Replay what already happened so a reload rejoins mid-run instead of showing nothing.
      for (const event of current?.events ?? []) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      listeners.add(response);
      const keepAlive = setInterval(() => response.write(": ping\n\n"), 15000);
      request.on("close", () => {
        clearInterval(keepAlive);
        listeners.delete(response);
      });
      return;
    }

    if (route.startsWith("/media/")) {
      const rest = decodeURIComponent(route.slice("/media/".length));
      const slug = rest.split("/")[0];
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        response.writeHead(400).end("Bad slug");
        return;
      }
      const base = path.join(videosRoot, slug);
      const target = path.resolve(base, rest.slice(slug.length + 1));
      // Never serve outside the project directory, whatever the path contains.
      if (target !== base && !target.startsWith(base + path.sep)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      await sendFile(request, response, target);
      return;
    }

    response.writeHead(404).end("Not found");
  } catch (error) {
    const message = String(error.message ?? error);
    const clientError =
      /^(?:Type "|Unknown (?:prompt profile|content provider)|Bad |Invalid backup|.* cannot be empty|The scene template|No scene prompts|Every scene)/.test(
        message,
      );
    sendJson(response, clientError ? 400 : 500, { error: message });
  }
});

let shuttingDown = false;
function shutDownStudio() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopStageChild();
  for (const response of listeners) response.end();
  server.close(() => process.exit(0));
  setTimeout(() => {
    stopStageChild("SIGKILL");
    process.exit(0);
  }, 2000);
}

process.once("SIGINT", shutDownStudio);
process.once("SIGTERM", shutDownStudio);

await restoreCurrent();

server.listen(port, "127.0.0.1", () => {
  console.log(`\n  YouTube studio\n  http://localhost:${port}\n`);
  console.log("  Paste a script, watch the pipeline run, play the result.");
  console.log("  Ctrl+C to stop.\n");
});
