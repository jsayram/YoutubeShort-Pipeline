import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  editNarrationLine,
  loadNarrationReview,
  readStudioSourceScript,
  resolveStudioScriptInput,
  selectNarrationTake,
  validateReview,
} from "./narration-review.mjs";
import { readJson, repoRoot, videoDir } from "./lib.mjs";

function take(id, text, passed = true) {
  return {
    id,
    generationId: `generation-${id}`,
    text,
    audio: `public/audio/lines/candidates/01/${id}.wav`,
    sourceAudio: `public/audio/lines/candidates/01/${id}-source.wav`,
    createdAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1200,
    qa: { passed, status: passed ? "passed" : "failed", analysis: {} },
  };
}

test("approval requires a passing selected take that speaks the current wording", () => {
  const state = {
    lines: [{
      index: 0,
      key: "01",
      text: "Current wording.",
      selectedTakeId: "old",
      takes: [take("old", "Earlier wording."), take("failed", "Current wording.", false)],
    }],
  };
  assert.equal(validateReview(state).valid, false);
  state.lines[0].selectedTakeId = "failed";
  assert.equal(validateReview(state).valid, false);
  state.lines[0].takes.push(take("current", "Current wording."));
  state.lines[0].selectedTakeId = "current";
  assert.equal(validateReview(state).valid, true);
});

test("saved narration edits override the immutable Studio source on rerun", async (t) => {
  const slug = `narration-source-test-${process.pid}-${Date.now()}`;
  const projectDir = videoDir(slug);
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(projectDir, "content"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "content", "narration.txt"),
    "My persistent narration edit.\n",
  );

  const first = await resolveStudioScriptInput(projectDir, "The untouched original script.", {
    preferNarration: true,
  });
  assert.equal(first.sourceScript, "The untouched original script.");
  assert.equal(first.narrationScript, "My persistent narration edit.");
  assert.equal(first.preservedNarration, true);

  const rerun = await resolveStudioScriptInput(projectDir, "A submitted replacement.", {
    preferNarration: true,
  });
  assert.equal(rerun.sourceScript, "The untouched original script.");
  assert.equal(rerun.narrationScript, "My persistent narration edit.");
  assert.equal(await readStudioSourceScript(projectDir), "The untouched original script.");
});

test("editing persists new text, retains take history, rebuilds prompts, and rejects old takes", async (t) => {
  const slug = `narration-review-test-${process.pid}-${Date.now()}`;
  const projectDir = videoDir(slug);
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(projectDir, "content"), { recursive: true });
  const template = await readJson(path.join(repoRoot, "templates", "video.json"));
  template.topic = "neutral";
  template.imageGen.style = "photographic";
  await fs.writeFile(path.join(projectDir, "video.json"), `${JSON.stringify(template, null, 2)}\n`);
  await fs.writeFile(
    path.join(projectDir, "content", "narration.txt"),
    "Original first line.\nSecond line stays.\n",
  );
  await fs.writeFile(
    path.join(projectDir, "content", "image-prompts.json"),
    `${JSON.stringify([
      { id: "01-original", prompt: "Original generated prompt." },
      { id: "02-hand-edited", prompt: "Keep this hand-edited second scene." },
    ], null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(projectDir, "content", "prompt-state.json"),
    `${JSON.stringify({
      version: 1,
      provider: "photographic",
      editedSceneIds: ["02-hand-edited"],
      preserveEditedScenes: true,
    }, null, 2)}\n`,
  );
  const state = {
    version: 1,
    status: "awaiting-review",
    settings: {},
    lines: [
      {
        index: 0,
        key: "01",
        text: "Original first line.",
        selectedTakeId: "old",
        takes: [take("old", "Original first line.")],
        approvalValid: true,
      },
      {
        index: 1,
        key: "02",
        text: "Second line stays.",
        selectedTakeId: "second",
        takes: [{ ...take("second", "Second line stays."), audio: "public/audio/second.wav" }],
        approvalValid: true,
      },
    ],
  };
  await fs.writeFile(
    path.join(projectDir, "content", "narration-review.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );

  await editNarrationLine(slug, 0, "Revised first line.");
  const restored = await loadNarrationReview(slug);
  assert.equal(restored.lines[0].text, "Revised first line.");
  assert.equal(restored.lines[0].selectedTakeId, null);
  assert.equal(restored.lines[0].takes.length, 1);
  assert.equal(restored.lines[0].takes[0].text, "Original first line.");
  await assert.rejects(
    selectNarrationTake(slug, 0, "old"),
    /earlier wording cannot be selected/i,
  );
  assert.match(
    await fs.readFile(path.join(projectDir, "content", "narration.txt"), "utf8"),
    /^Revised first line\.\nSecond line stays\.\n$/,
  );
  const prompts = await readJson(path.join(projectDir, "content", "image-prompts.json"));
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].prompt, /Revised first line/i);
  assert.equal(prompts[1].prompt, "Keep this hand-edited second scene.");
  assert.deepEqual(
    (await readJson(path.join(projectDir, "content", "prompt-state.json"))).editedSceneIds,
    ["02-hand-edited"],
  );
  assert.equal(
    (await readJson(path.join(projectDir, "content", "pipeline-stale.json"))).reason,
    "narration-edited",
  );
});

test("Studio orders narration before images and keeps refresh and automatic paths wired", async () => {
  const [studio, html] = await Promise.all([
    fs.readFile(path.join(repoRoot, "scripts", "studio.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "scripts", "studio", "index.html"), "utf8"),
  ]);
  const stageBlock = studio.slice(studio.indexOf("function stageList"), studio.indexOf("async function startRun"));
  assert.ok(stageBlock.indexOf('id: "voice"') < stageBlock.indexOf('id: "images"'));
  assert.match(studio, /options\.reviewNarration === false\) voiceArgs\.push\("--auto-approve"\)/);
  assert.match(studio, /resolveStudioScriptInput\(projectDir, scriptText/);
  assert.match(studio, /preferNarration: exists/);
  assert.match(studio, /route === "\/api\/narration-review" && request\.method === "GET"/);
  assert.match(studio, /setStage\("review", "waiting"/);
  assert.match(
    studio.slice(
      studio.indexOf("async function resumeAfterNarrationReview"),
      studio.indexOf("function publicReviewState"),
    ),
    /await emitPrompts\(slug\)/,
  );
  assert.match(html, /id="opt-review-narration" checked/);
  assert.match(html, /Approve narration and generate images/);
  assert.match(html, /loadNarrationReview\(slug\)/);
});
