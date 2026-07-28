import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv, parseArgs, readJson, repoRoot, run, videoDir } from "./lib.mjs";
import { resolveStyles } from "./image-styles.mjs";

await loadEnv();

// A local control room for the pipeline. Paste a script, watch every stage run top to bottom,
// see each still as it lands, and play the finished file at the bottom. It drives the same
// scripts the CLI does — no second code path into the pipeline, so anything that works here
// works from a terminal and vice versa.

const { flags } = parseArgs();
const port = Number(flags.port ?? process.env.STUDIO_PORT ?? 4300);
const studioDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "studio");
const videosRoot = path.join(repoRoot, "videos");

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

function emit(event) {
  if (!current) return;
  const payload = { ...event, at: Date.now() };
  current.events.push(payload);
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
      if (current) current.child = null;
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
    { id: "images", label: "Images", status: "pending" },
    { id: "voice", label: "Narration", status: "pending" },
    { id: "compose", label: "Composition", status: "pending" },
    { id: "check", label: "Validation", status: "pending" },
  ];
  if (options.render) stages.push({ id: "render", label: "Render", status: "pending" });
  return stages;
}

async function startRun({ slug, title, scriptText, options }) {
  const projectDir = videoDir(slug);
  const exists = await fs.access(projectDir).then(() => true, () => false);

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
    // Persist the chosen voice into video.json so the project keeps it, and so a later CLI run
    // speaks in the same voice as the one started from here.
    if (options.profile) {
      prepareArgs.push("--profile", options.profile);
      const voices = (await listVoices()) ?? [];
      const chosen = voices.find((voice) => voice.name === options.profile);
      if (chosen?.engine) prepareArgs.push("--engine", chosen.engine);
    }
    if (options.style) {
      prepareArgs.push("--style", options.style);
      if (options.fast) prepareArgs.push("--fast");
    }
    await runStage("script", node, prepareArgs);
    await fs.rm(scriptFile, { force: true });
    await emitPrompts(slug);

    if (options.skipImages) setStage("images", "skipped");
    else {
      const imageArgs = [script("generate-images.mjs"), "--project", slug];
      if (options.force) imageArgs.push("--force");
      await runStage("images", node, imageArgs, {
        onLine: (line) => {
          // generate-images-local logs "[3/7] 03-topics — 12.4s" as each still finishes.
          const match = line.match(/^\[(\d+)\/(\d+)\]\s+(\S+)\s+[—-]/);
          if (match) void emitImage(slug, match[3], Number(match[1]), Number(match[2]));
        },
      });
      await emitImages(slug);
    }

    if (options.skipVoice) setStage("voice", "skipped");
    else {
      const voiceArgs = [script("generate-story.mjs"), "--project", slug];
      if (options.resume) voiceArgs.push("--resume");
      await runStage("voice", node, voiceArgs);
      await emitTiming(slug);
    }

    const composeArgs = [script("compose-slideshow.mjs"), "--project", slug];
    if (options.forceCompose) composeArgs.push("--force");
    await runStage("compose", node, composeArgs);

    const config = await readJson(path.join(projectDir, "video.json"));
    await runStage(
      "check",
      "npx",
      ["--yes", `hyperframes@${config.hyperframesVersion}`, "check"],
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

    emit({ type: "done", slug });
  } catch (error) {
    emit({ type: "error", message: String(error.message ?? error) });
  } finally {
    if (current) current.done = true;
  }
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
    if (current) current.done = true;
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
    lines: timing.lines ?? [],
  });
}

async function emitVideo(slug) {
  const file = path.join(videoDir(slug), "renders", `${slug}.mp4`);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return;
  emit({
    type: "video",
    url: `/media/${slug}/renders/${slug}.mp4?v=${Date.now()}`,
    bytes: stat.size,
  });
}

// ---------------------------------------------------------------------------- voicebox

const voiceboxUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");

// Voicebox is the authority on which voices exist, so the picker reads them live rather than
// keeping its own list that can drift out of date.
async function listVoices() {
  const response = await fetch(`${voiceboxUrl}/profiles`).catch(() => null);
  if (!response?.ok) return null;
  const profiles = await response.json().catch(() => null);
  if (!Array.isArray(profiles)) return null;
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description ?? "",
    language: profile.language ?? "",
    cloned: profile.voice_type === "cloned",
    // A preset voice carries the engine it was built for. Picking one and leaving the project's
    // old engine in place is how you get a voice that will not speak.
    engine: profile.preset_engine ?? profile.default_engine ?? null,
    generations: profile.generation_count ?? 0,
  }));
}

// ---------------------------------------------------------------------------- image styles

const comfyUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");

async function fetchJson(url, timeoutMs = 1800) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function serviceSnapshot() {
  const [comfyStats, comfyQueue, voiceHealth, template] = await Promise.all([
    fetchJson(`${comfyUrl}/system_stats`),
    fetchJson(`${comfyUrl}/queue`),
    fetchJson(`${voiceboxUrl}/health`),
    readJson(path.join(repoRoot, "templates", "video.json")).catch(() => null),
  ]);

  const device = comfyStats?.devices?.[0] ?? null;
  const runningJobs = comfyQueue?.queue_running?.length ?? 0;
  const pendingJobs = comfyQueue?.queue_pending?.length ?? 0;
  const comfyRunning = Boolean(comfyStats);
  const voiceRunning = voiceHealth?.status === "healthy";

  return {
    checkedAt: Date.now(),
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
        status: comfyRunning ? (runningJobs ? "busy" : "running") : "offline",
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
        status: voiceRunning ? "running" : "offline",
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
        action: voiceRunning ? "Open Voicebox" : null,
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

// ---------------------------------------------------------------------------- http

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  response.end(text);
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
        projects.push({ slug: entry.name, title: config.title, duration: config.duration, rendered });
      }
      sendJson(response, 200, { projects });
      return;
    }

    // Bring an existing project directory under videos/ so the studio can drive it. Copies
    // rather than symlinks: the HyperFrames CLI, npx and the media server all resolve real
    // paths, and a symlink pointing outside the tree would also defeat the /media path guard.
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
          loras: (style.loras ?? []).map((lora) => lora.name),
          download: style.download ?? null,
        })),
        speedLora,
        speedSampling,
        default: "photographic",
      });
      return;
    }

    if (route === "/api/services") {
      sendJson(response, 200, await serviceSnapshot());
      return;
    }

    if (route === "/api/services/voicebox/open" && request.method === "POST") {
      await run("open", ["-a", "Voicebox"]);
      sendJson(response, 200, { opened: true });
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
      const images = [];
      for (const prompt of Array.isArray(prompts) ? prompts : []) {
        const file = await findGenerated(slug, prompt.id);
        images.push({
          id: prompt.id,
          ready: Boolean(file),
          url: file ? `/media/${slug}/public/generated/${file}?v=${Date.now()}` : null,
        });
      }
      sendJson(response, 200, {
        slug,
        total: images.length,
        generated: images.filter((image) => image.ready).length,
        images,
      });
      return;
    }

    if (route === "/api/state") {
      sendJson(response, 200, {
        busy: Boolean(current && !current.done),
        run: current
          ? { id: current.id, slug: current.slug, stages: current.stages, done: current.done }
          : null,
      });
      return;
    }

    if (route === "/api/run" && request.method === "POST") {
      if (current && !current.done) {
        sendJson(response, 409, { error: "A run is already in progress." });
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
      current?.child?.kill("SIGTERM");
      sendJson(response, 200, { cancelled: true });
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
    sendJson(response, 500, { error: String(error.message ?? error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`\n  YouTube Short studio\n  http://localhost:${port}\n`);
  console.log("  Paste a script, watch the pipeline run, play the result.");
  console.log("  Ctrl+C to stop.\n");
});
