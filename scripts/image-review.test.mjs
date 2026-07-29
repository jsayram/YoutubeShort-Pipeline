import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  approveAllImages,
  approveImage,
  editImagePrompt,
  loadImageReview,
  prepareImageReview,
  selectImageTake,
  validateImageReview,
} from "./image-review.mjs";
import { videoDir } from "./lib.mjs";

test("image review retains takes, gates continuation, and keeps scene edits project-local", async (t) => {
  const slug = `image-review-test-${process.pid}-${Date.now()}`;
  const projectDir = videoDir(slug);
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(projectDir, "content"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "public", "generated", "audit"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "content", "narration.txt"),
    "The mirror is wrong.\n",
  );
  await fs.writeFile(
    path.join(projectDir, "content", "image-prompts.json"),
    `${JSON.stringify([{ id: "01-mirror", prompt: "A cracked mirror." }], null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(projectDir, "content", "image-prompts.enriched.json"),
    `${JSON.stringify([{
      id: "01-mirror",
      prompt: "A cracked mirror in warm light.",
      enrichment: { sourcePrompt: "A cracked mirror." },
    }], null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(projectDir, "public", "generated", "01-mirror.png"),
    Buffer.from("first-image"),
  );
  await fs.writeFile(
    path.join(projectDir, "public", "generated", "manifest.json"),
    `${JSON.stringify([{
      id: "01-mirror",
      file: "public/generated/01-mirror.png",
      provider: "cloudflare-flux2",
      model: "flux",
      prompt: "FINAL: A cracked mirror in warm light.",
      seed: 42,
    }], null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(projectDir, "public", "generated", "audit", "latest.json"),
    `${JSON.stringify({
      runId: "audit-one",
      provider: "cloudflare-flux2",
      usage: {
        requests: 1,
        creditsUsed: null,
        quotaRemaining: null,
        quotaNote: "Quota not reported.",
      },
      scenes: [{
        id: "01-mirror",
        status: "completed",
        overlayPrompt: "A cracked mirror in warm light.",
        finalPrompt: "FINAL: A cracked mirror in warm light.",
        seed: 42,
        settings: { steps: 4 },
      }],
    }, null, 2)}\n`,
  );

  let state = await prepareImageReview(slug, { captions: false });
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].takes.length, 1);
  assert.equal(state.lines[0].approved, true);
  assert.equal(state.usage.requests, 1);
  assert.equal(state.usage.creditsUsed, null);
  assert.equal(state.lines[0].takes[0].usage.creditsUsed, null);
  assert.equal(validateImageReview(state).valid, true);
  await fs.access(path.join(projectDir, state.lines[0].takes[0].image));

  // Batch approval remains available for older or manually unapproved review files.
  state.lines[0].approved = false;
  await fs.writeFile(
    path.join(projectDir, "content", "image-review.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  state = await approveAllImages(slug);
  assert.equal(state.lines[0].approved, true);
  assert.equal(validateImageReview(state).valid, true);

  state = await approveImage(slug, 0);
  assert.equal(validateImageReview(state).valid, true);

  const oldTakeId = state.lines[0].selectedTakeId;
  state = await editImagePrompt(slug, 0, "A small oval mirror with one subtle crack.");
  assert.equal(state.lines[0].approved, false);
  assert.equal(validateImageReview(state).valid, false);
  await assert.rejects(selectImageTake(slug, 0, oldTakeId), /earlier prompt/i);

  const base = JSON.parse(
    await fs.readFile(path.join(projectDir, "content", "image-prompts.json"), "utf8"),
  );
  const overlay = JSON.parse(
    await fs.readFile(path.join(projectDir, "content", "image-prompts.enriched.json"), "utf8"),
  );
  assert.equal(base[0].prompt, "A small oval mirror with one subtle crack.");
  assert.equal(overlay[0].prompt, "A small oval mirror with one subtle crack.");
  assert.equal(overlay[0].enrichment.sourcePrompt, "A small oval mirror with one subtle crack.");
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(projectDir, "content", "prompt-state.json"), "utf8"))
      .editedSceneIds,
    ["01-mirror"],
  );
  assert.equal((await loadImageReview(slug)).lines[0].takes.length, 1);
});

test("Studio pauses after images and exposes per-image approval and usage controls", async () => {
  const [studio, html] = await Promise.all([
    fs.readFile(new URL("./studio.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("./studio/index.html", import.meta.url), "utf8"),
  ]);
  const stageBlock = studio.slice(
    studio.indexOf("function stageList"),
    studio.indexOf("async function startRun"),
  );
  assert.ok(stageBlock.indexOf('id: "images"') < stageBlock.indexOf('id: "image-review"'));
  assert.ok(stageBlock.indexOf('id: "image-review"') < stageBlock.indexOf('id: "compose"'));
  assert.match(studio, /prepareImageReview\(slug, options\)/);
  assert.match(studio, /reason: "image-review"/);
  assert.match(studio, /route === "\/api\/image-review\/regenerate"/);
  assert.match(studio, /route === "\/api\/image-review\/approve-image"/);
  assert.match(studio, /route === "\/api\/image-review\/approve-all"/);
  assert.match(studio, /route === "\/api\/image-review\/continue"/);
  assert.match(html, /Regenerate this image/);
  assert.match(html, /Approve image/);
  assert.match(html, /Approve all images/);
  assert.match(html, /Successful images are approved automatically/);
  assert.match(html, /Continue to composition/);
  assert.match(html, /Generation details and exact provider prompt/);
  assert.match(html, /credit cost not reported/);
  assert.match(html, /quota not reported/);
});
