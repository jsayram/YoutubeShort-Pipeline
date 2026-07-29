import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repoRoot } from "./lib.mjs";

const read = (relative) => fs.readFile(path.join(repoRoot, relative), "utf8");

test("imported projects keep the force-image control connected end to end", async () => {
  const [html, studio, local, flux, cloudflare, gemini] = await Promise.all([
    read("scripts/studio/index.html"),
    read("scripts/studio.mjs"),
    read("scripts/generate-images-local.mjs"),
    read("scripts/generate-images-flux2-local.mjs"),
    read("scripts/generate-images-cloudflare.mjs"),
    read("scripts/generate-images-gemini.mjs"),
  ]);

  assert.match(html, /id="opt-force"[^>]*>\s*Regenerate existing images/i);
  assert.match(html, /force:\s*\$\("opt-force"\)\.checked/);
  assert.match(studio, /if \(options\.force\) imageArgs\.push\("--force"\)/);
  assert.match(local, /isReference \? flags\["force-references"\] : flags\.force/);
  assert.match(flux, /existing && !flags\.force/);
  assert.match(cloudflare, /existing && !flags\.force/);
  assert.match(gemini, /if \(!flags\.force\)/);
  assert.match(gemini, /for \(const oldExtension of generatedExtensions\)/);
  assert.match(gemini, /oldExtension === extension/);
});

test("refresh has a visible status action and a separate confirmed full restart", async () => {
  const [html, studio] = await Promise.all([
    read("scripts/studio/index.html"),
    read("scripts/studio.mjs"),
  ]);

  assert.match(html, /id="refresh-services"[^>]*>Check status</i);
  assert.match(html, /id="restart-services"[^>]*>Restart everything/i);
  assert.match(html, /window\.addEventListener\("beforeunload"/);
  assert.match(html, /window\.addEventListener\("pagehide"/);
  assert.match(html, /navigator\.sendBeacon\("\/api\/services\/reset"\)/);
  assert.match(html, /setServicesRestarting\(data\.resetting === true\)/);
  assert.match(studio, /route === "\/api\/services\/reset"/);
  assert.match(studio, /restartComfyUi\(\), restartVoicebox\(\)/);
  assert.match(studio, /waitForNoProcesses\("voicebox", 15000\)/);
  assert.match(studio, /waitForNoListener\(voiceboxPort, 8000\)/);
  assert.match(studio, /consecutive >= 3/);
  assert.match(studio, /const voicebox = await waitForVoiceboxStable\(45000\)/);
});

test("local LLM enrichment stays an optional provider-independent overlay", async () => {
  const [html, studio, dispatcher, local, flux, cloudflare, gemini, template] =
    await Promise.all([
      read("scripts/studio/index.html"),
      read("scripts/studio.mjs"),
      read("scripts/generate-images.mjs"),
      read("scripts/generate-images-local.mjs"),
      read("scripts/generate-images-flux2-local.mjs"),
      read("scripts/generate-images-cloudflare.mjs"),
      read("scripts/generate-images-gemini.mjs"),
      read("templates/video.json"),
    ]);

  assert.match(html, /id="opt-enrich" checked/);
  assert.match(html, /enrichWithLLM:\s*\$\("opt-enrich"\)\.checked/);
  assert.match(studio, /preparedConfig\.imageGen\.enrichWithLLM = options\.enrichWithLLM !== false/);
  assert.match(studio, /name:\s*`\$\{localLlm\.name\} prompt director`/);
  assert.equal(JSON.parse(template).imageGen.enrichWithLLM, true);

  assert.match(dispatcher, /config\.imageGen\?\.enrichWithLLM === true/);
  assert.match(dispatcher, /IMAGE_PROMPTS_FILE:\s*promptOverlay/);
  assert.match(dispatcher, /Continuing with the provider's normal prompts/);
  for (const backend of [local, flux, cloudflare, gemini]) {
    assert.match(backend, /process\.env\.IMAGE_PROMPTS_FILE/);
  }
});
