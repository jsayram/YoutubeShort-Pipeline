import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name ?? "Error",
    message: String(error.message ?? error),
    stack: error.stack ? String(error.stack) : null,
    cause: error.cause ? serializeError(error.cause) : null,
  };
}

function sanitize(value, key = "") {
  if (/token|secret|authorization|api[-_]?key|password/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]),
    );
  }
  return value;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(sanitize(value), null, 2)}\n`);
  await fs.rename(temporary, filePath);
}

export async function createImageGenerationAudit({
  projectDir,
  project,
  provider,
  service,
  configuration,
  promptFile,
  prompts,
}) {
  const context = process.env.IMAGE_AUDIT_CONTEXT
    ? await fs
        .readFile(process.env.IMAGE_AUDIT_CONTEXT, "utf8")
        .then(JSON.parse)
        .catch(() => null)
    : null;
  const runId = context?.runId ?? `${safeTimestamp()}-${randomUUID().slice(0, 8)}`;
  const auditDir = path.join(projectDir, "public", "generated", "audit");
  const runPath = path.join(auditDir, `${runId}.json`);
  const latestPath = path.join(auditDir, "latest.json");
  const document = {
    version: 1,
    runId,
    project,
    provider,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    invocation: context?.invocation ?? {
      command: process.execPath,
      arguments: process.argv.slice(1),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    dispatcher: context,
    promptSource: {
      selectedFile: path.relative(projectDir, promptFile).split(path.sep).join("/"),
      enrichedOverlay: Boolean(process.env.IMAGE_PROMPTS_FILE),
    },
    service,
    configuration,
    scenes: prompts.map((item) => ({
      id: item.id,
      kind: item.kind ?? "scene",
      castMode: item.castMode ?? null,
      sourcePrompt: item.enrichment?.sourcePrompt ?? item.prompt,
      enrichment: item.enrichment ?? null,
      overlayPrompt: item.prompt,
      finalPrompt: null,
      seed: null,
      settings: null,
      references: [],
      status: "pending",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      output: null,
      providerResponse: null,
      error: null,
    })),
    events: [],
  };

  async function persist() {
    await writeJsonAtomic(runPath, document);
    await writeJsonAtomic(latestPath, document);
  }

  function scene(id) {
    let record = document.scenes.find((entry) => entry.id === id);
    if (!record) {
      record = { id, status: "pending" };
      document.scenes.push(record);
    }
    return record;
  }

  await persist();
  return {
    runId,
    runPath,
    document,
    async event(type, detail = {}) {
      document.events.push({ at: new Date().toISOString(), type, ...detail });
      await persist();
    },
    async startScene(id, detail = {}) {
      const record = scene(id);
      Object.assign(record, detail, {
        status: "running",
        startedAt: new Date().toISOString(),
        error: null,
      });
      await persist();
    },
    async completeScene(id, detail = {}) {
      const record = scene(id);
      const completedAt = new Date().toISOString();
      Object.assign(record, detail, {
        status: detail.status ?? "completed",
        completedAt,
        durationMs: record.startedAt
          ? Date.parse(completedAt) - Date.parse(record.startedAt)
          : null,
      });
      if (record.output?.file) {
        const absolute = path.join(projectDir, record.output.file);
        const bytes = await fs.readFile(absolute).catch(() => null);
        if (bytes) {
          record.artifact = {
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        }
      }
      await persist();
    },
    async failScene(id, error, detail = {}) {
      const record = scene(id);
      const completedAt = new Date().toISOString();
      Object.assign(record, detail, {
        status: "failed",
        completedAt,
        durationMs: record.startedAt
          ? Date.parse(completedAt) - Date.parse(record.startedAt)
          : null,
        error: serializeError(error),
      });
      document.status = "failed";
      await persist();
    },
    async finish(status = "completed", detail = {}) {
      document.status = status;
      document.completedAt = new Date().toISOString();
      Object.assign(document, detail);
      await persist();
    },
    async fail(error, detail = {}) {
      document.status = "failed";
      document.completedAt = new Date().toISOString();
      document.error = serializeError(error);
      Object.assign(document, detail);
      await persist();
    },
  };
}

export function selectedScenePrefixes(flags) {
  const raw = flags.only ?? flags.scenes ?? flags.scene;
  if (!raw || raw === true) return [];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function selectRequestedScenes(scenes, flags) {
  const prefixes = selectedScenePrefixes(flags);
  if (!prefixes.length) return { scenes, prefixes, partial: false };
  const selected = scenes.filter((scene) =>
    prefixes.some((prefix) => scene.id === prefix || scene.id.startsWith(`${prefix}-`)),
  );
  if (!selected.length) {
    throw new Error(`No scenes matched --only ${prefixes.join(",")}.`);
  }
  return { scenes: selected, prefixes, partial: true };
}

export async function mergePartialManifest(projectDir, entries) {
  const manifestPath = path.join(projectDir, "public", "generated", "manifest.json");
  const previous = await fs
    .readFile(manifestPath, "utf8")
    .then(JSON.parse)
    .catch(() => []);
  const updates = new Map(entries.map((entry) => [entry.id, entry]));
  const merged = previous.map((entry) => updates.get(entry.id) ?? entry);
  for (const entry of entries) {
    if (!previous.some((previousEntry) => previousEntry.id === entry.id)) merged.push(entry);
  }
  return merged;
}
