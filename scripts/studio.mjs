import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson, repoRoot, videoDir } from "./lib.mjs";

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

// ---------------------------------------------------------------------------- http

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  response.end(text);
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
