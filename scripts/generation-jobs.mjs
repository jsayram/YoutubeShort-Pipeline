import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJson, videoDir } from "./lib.mjs";

export const JOB_STATES = Object.freeze([
  "planned",
  "awaiting-confirmation",
  "authorized",
  "submitted",
  "running",
  "succeeded",
  "failed",
  "cancel-requested",
  "cancelled",
  "unknown",
]);

export const BLOCKING_JOB_STATES = new Set([
  "planned",
  "awaiting-confirmation",
  "authorized",
  "submitted",
  "running",
  "cancel-requested",
  "unknown",
]);

export function providerOutcomeIsUncertain(error) {
  return /(?:fetch failed|network|socket|connection|timed? out|timeout|aborted|econnreset|econnrefused)/i.test(
    String(error?.message ?? error),
  );
}

const TERMINAL_JOB_STATES = new Set(["succeeded", "failed", "cancelled"]);
const writeChains = new Map();

export function jobsPath(slug) {
  return path.join(videoDir(slug), "content", "generation-jobs.json");
}

export async function loadJobs(slug) {
  const value = await readJson(jobsPath(slug)).catch(() => null);
  return {
    version: 1,
    project: slug,
    updatedAt: value?.updatedAt ?? null,
    jobs: Array.isArray(value?.jobs) ? value.jobs : [],
  };
}

export async function listJobs(slug, { limit = 200 } = {}) {
  const ledger = await loadJobs(slug);
  return ledger.jobs
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit)
    .map(publicJob);
}

export async function createJob(slug, input) {
  return mutateLedger(slug, (ledger) => {
    const duplicate = ledger.jobs.find(
      (job) =>
        BLOCKING_JOB_STATES.has(job.status) &&
        job.dedupeKey &&
        input.dedupeKey &&
        job.dedupeKey === input.dedupeKey,
    );
    if (duplicate) return duplicate;

    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      project: slug,
      status: input.requiresConfirmation === false ? "authorized" : "awaiting-confirmation",
      kind: String(input.kind ?? "generation"),
      provider: String(input.provider ?? "local"),
      model: input.model ? String(input.model) : null,
      item: input.item ?? null,
      label: String(input.label ?? input.kind ?? "Generation"),
      destination: input.destination ?? null,
      estimate: sanitize(input.estimate ?? null),
      actual: null,
      providerRequestId: null,
      artifact: null,
      error: null,
      warning: input.warning ?? null,
      monetary: input.monetary === true,
      remote: input.remote === true,
      dedupeKey: input.dedupeKey ?? null,
      authorization: null,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      completedAt: null,
      history: [{ status: input.requiresConfirmation === false ? "authorized" : "awaiting-confirmation", at: now }],
    };
    ledger.jobs.push(job);
    return job;
  });
}

export async function authorizeJob(slug, id, acknowledgement) {
  if (
    acknowledgement !== "I understand this request may consume credits" &&
    acknowledgement !== "I authorize this generation"
  ) {
    throw new Error("Credit acknowledgement did not match.");
  }
  return transitionJob(slug, id, "authorized", {
    authorization: {
      id: randomUUID(),
      confirmedAt: new Date().toISOString(),
      acknowledgement,
    },
  });
}

export async function transitionJob(slug, id, status, patch = {}) {
  if (!JOB_STATES.includes(status)) throw new Error(`Unknown job state "${status}".`);
  return mutateLedger(slug, (ledger) => {
    const job = ledger.jobs.find((entry) => entry.id === id);
    if (!job) throw new Error(`Generation job "${id}" was not found.`);
    assertTransition(job.status, status);
    const now = new Date().toISOString();
    Object.assign(job, sanitize(patch), { status, updatedAt: now });
    if (status === "submitted" && !job.submittedAt) job.submittedAt = now;
    if (TERMINAL_JOB_STATES.has(status)) job.completedAt = now;
    job.history ??= [];
    job.history.push({ status, at: now });
    return job;
  });
}

export async function findJob(slug, id) {
  const ledger = await loadJobs(slug);
  return publicJob(ledger.jobs.find((entry) => entry.id === id) ?? null);
}

export async function blockingJobs(slug) {
  const ledger = await loadJobs(slug);
  return ledger.jobs.filter((job) => BLOCKING_JOB_STATES.has(job.status)).map(publicJob);
}

export async function markInterruptedJobsUnknown(slug) {
  return mutateLedger(slug, (ledger) => {
    const now = new Date().toISOString();
    const changed = [];
    for (const job of ledger.jobs) {
      if (!["submitted", "running", "cancel-requested"].includes(job.status)) continue;
      job.status = "unknown";
      job.updatedAt = now;
      job.error = {
        message:
          "Studio restarted after provider submission. This job will not be retried automatically.",
      };
      job.history ??= [];
      job.history.push({ status: "unknown", at: now });
      changed.push(job);
    }
    return changed;
  });
}

export function publicJob(job) {
  if (!job) return null;
  const copy = structuredClone(job);
  if (copy.authorization) {
    copy.authorization = { confirmedAt: copy.authorization.confirmedAt };
  }
  return sanitize(copy);
}

async function mutateLedger(slug, mutator) {
  const previous = writeChains.get(slug) ?? Promise.resolve();
  let result;
  const next = previous
    .catch(() => {})
    .then(async () => {
      const ledger = await loadJobs(slug);
      result = mutator(ledger);
      ledger.updatedAt = new Date().toISOString();
      await writeAtomic(jobsPath(slug), ledger);
    });
  writeChains.set(slug, next);
  await next;
  return publicJob(result);
}

function assertTransition(from, to) {
  if (from === to) return;
  if (TERMINAL_JOB_STATES.has(from)) {
    throw new Error(`Generation job is already ${from}.`);
  }
  const allowed = {
    planned: ["awaiting-confirmation", "authorized", "cancelled"],
    "awaiting-confirmation": ["authorized", "cancelled"],
    authorized: ["submitted", "cancelled"],
    submitted: ["running", "succeeded", "failed", "cancel-requested", "unknown"],
    running: ["succeeded", "failed", "cancel-requested", "unknown"],
    "cancel-requested": ["cancelled", "succeeded", "failed", "unknown"],
    unknown: ["succeeded", "failed", "cancelled"],
  };
  if (!allowed[from]?.includes(to)) {
    throw new Error(`Generation job cannot move from ${from} to ${to}.`);
  }
}

function sanitize(value, key = "") {
  if (/token|secret|authorization|api[-_]?key|password/i.test(key)) {
    if (key === "authorization" && value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries({
          id: value.id,
          confirmedAt: value.confirmedAt,
          acknowledgement: value.acknowledgement,
        }).filter(([, child]) => child !== undefined),
      );
    }
    return "[redacted]";
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]),
    );
  }
  return value;
}

async function writeAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(sanitize(value), null, 2)}\n`);
  await fs.rename(temporary, file);
}
