import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createJob, authorizeJob, transitionJob } from "./generation-jobs.mjs";
import { videoDir } from "./lib.mjs";

const slug = `job-test-${process.pid}`;

test.after(async () => {
  await fs.rm(videoDir(slug), { recursive: true, force: true });
});

test("durable jobs require explicit acknowledgement and reject duplicate active work", async () => {
  const first = await createJob(slug, {
    kind: "narration-line",
    provider: "elevenlabs",
    remote: true,
    monetary: true,
    requiresConfirmation: true,
    dedupeKey: "line:1",
  });
  assert.equal(first.status, "awaiting-confirmation");
  const duplicate = await createJob(slug, {
    kind: "narration-line",
    provider: "elevenlabs",
    requiresConfirmation: true,
    dedupeKey: "line:1",
  });
  assert.equal(duplicate.id, first.id);
  await assert.rejects(() => authorizeJob(slug, first.id, "yes"), /acknowledgement/);
  const authorized = await authorizeJob(
    slug,
    first.id,
    "I understand this request may consume credits",
  );
  assert.equal(authorized.status, "authorized");
  assert.deepEqual(authorized.authorization, { confirmedAt: authorized.authorization.confirmedAt });
  assert.ok(Date.parse(authorized.authorization.confirmedAt));
  assert.equal((await transitionJob(slug, first.id, "submitted")).status, "submitted");
  assert.equal((await transitionJob(slug, first.id, "running")).status, "running");
  assert.equal(
    (await transitionJob(slug, first.id, "succeeded", {
      actual: { credits: 42 },
      artifact: path.join("public", "audio", "line.wav"),
    })).status,
    "succeeded",
  );
});
