import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createImageGenerationAudit,
  selectRequestedScenes,
} from "./image-generation-audit.mjs";
import { repoRoot } from "./lib.mjs";

test("scene selection supports safe partial rerenders", () => {
  const all = [
    { id: "01-opening" },
    { id: "05-turn" },
    { id: "06-close" },
    { id: "10-end" },
  ];
  const result = selectRequestedScenes(all, { only: "01,05,06" });
  assert.equal(result.partial, true);
  assert.deepEqual(result.scenes.map((scene) => scene.id), [
    "01-opening",
    "05-turn",
    "06-close",
  ]);
});

test("dispatcher freezes the exact enriched overlay until refresh is explicit", async () => {
  const dispatcher = await fs.readFile(path.join(repoRoot, "scripts", "generate-images.mjs"), "utf8");
  assert.match(dispatcher, /flags\["reuse-enriched"\] === true/);
  assert.match(dispatcher, /promptOverlay = enrichedPath/);
  assert.match(dispatcher, /status: "reused"/);
  assert.match(dispatcher, /flags\["refresh-enriched"\] !== true/);
  assert.match(dispatcher, /overlayMatchesCurrentSource/);
});

test("audit records prompts, settings, errors, hashes, and redacts credentials", async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-audit-test-"));
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  const output = path.join(projectDir, "public", "generated", "01.png");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, Buffer.from("test-image"));

  const audit = await createImageGenerationAudit({
    projectDir,
    project: "audit-test",
    provider: "comfyui",
    service: { baseUrl: "http://127.0.0.1:8188", apiKey: "must-not-leak" },
    configuration: { checkpoint: "model.safetensors", steps: 30 },
    promptFile: path.join(projectDir, "content", "image-prompts.enriched.json"),
    prompts: [
      {
        id: "01",
        prompt: "short exact overlay prompt",
        enrichment: {
          sourcePrompt: "original prompt",
          description: "concrete scene",
        },
      },
      {
        id: "02",
        prompt: "second prompt",
      },
    ],
  });
  await audit.startScene("01", {
    finalPrompt: "exact final positive prompt",
    negativePrompt: "exact negative prompt",
    seed: 123,
    settings: { steps: 30, cfg: 6 },
  });
  await audit.completeScene("01", {
    output: { file: "public/generated/01.png" },
  });
  await audit.startScene("02", { finalPrompt: "failed final prompt", seed: 456 });
  await audit.failScene("02", new Error("provider rejected the scene"));
  await audit.finish("failed");

  const saved = JSON.parse(await fs.readFile(audit.runPath, "utf8"));
  assert.equal(saved.scenes[0].sourcePrompt, "original prompt");
  assert.equal(saved.scenes[0].overlayPrompt, "short exact overlay prompt");
  assert.equal(saved.scenes[0].finalPrompt, "exact final positive prompt");
  assert.equal(saved.scenes[0].seed, 123);
  assert.equal(saved.scenes[0].artifact.bytes, 10);
  assert.match(saved.scenes[0].artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(saved.scenes[1].status, "failed");
  assert.equal(saved.scenes[1].error.message, "provider rejected the scene");
  assert.match(saved.scenes[1].error.stack, /provider rejected the scene/);
  assert.equal(saved.service.apiKey, "[redacted]");
});
