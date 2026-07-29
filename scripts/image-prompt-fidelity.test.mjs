import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  deconflictNegativePrompt,
  makeWordlessVisualPrompt,
  repoRoot,
  scrubTextNouns,
  splitNegations,
} from "./lib.mjs";
import { buildFluxPrompt, buildGeminiPrompt } from "./image-worker-common.mjs";

const qwenScene =
  "dim amber glow, cracked smartphone screen, dusty wooden table, " +
  "single unread message bubble, old vinyl record sleeve, rain streaked window, " +
  "dust motes dancing in shafts of light, cold gray morning, worn leather jacket, " +
  "shadowed silhouette, shallow depth of field, soft focus background, melancholic atmosphere";

test("wordless conversion preserves the phone and replaces message content with light", () => {
  const converted = makeWordlessVisualPrompt(qwenScene);
  assert.match(converted, /cracked smartphone screen/i);
  assert.match(converted, /soft notification glow on the phone/i);
  assert.match(converted, /old vinyl record sleeve/i);
  assert.doesNotMatch(converted, /message bubble/i);

  const scrubbed = scrubTextNouns(converted);
  assert.match(scrubbed, /cracked smartphone screen/i);
  assert.match(scrubbed, /notification glow/i);

  assert.equal(
    makeWordlessVisualPrompt("cracked phone, glowing amber text message prompt"),
    "cracked phone, glowing amber soft notification glow on the phone",
  );
  assert.equal(
    makeWordlessVisualPrompt("screen lit by a faint soft notification glow"),
    "screen lit by a faint soft notification glow",
  );
  assert.equal(
    splitNegations("heart image glowing on the phone with no lettering, vinyl sleeve").positive,
    "heart image glowing on the phone, vinyl sleeve",
  );
});

test("wordless cleanup preserves a prop that shares a clause with a logo", () => {
  const cleaned = scrubTextNouns(
    "A cracked frosted-glass milkshake cup with a faded red logo sits on the pharmacy counter.",
  );
  assert.match(cleaned, /cracked frosted-glass milkshake cup/i);
  assert.match(cleaned, /pharmacy counter/i);
  assert.match(cleaned, /abstract pictorial mark/i);
  assert.doesNotMatch(cleaned, /\blogo\b/i);
});

test("scene-required props and lighting override conflicting global negatives", () => {
  const positive = makeWordlessVisualPrompt(qwenScene);
  const negative = deconflictNegativePrompt(
    positive,
    "readable text, app screen, glowing display, user interface, icon, amber light, " +
      "daylight, overcast sky, pale grey backdrop, silhouette-only character, " +
      "face hidden by default, hidden eyes, watermark",
  );
  assert.match(negative, /readable text/i);
  assert.match(negative, /\bicon\b/i);
  assert.match(negative, /watermark/i);
  assert.doesNotMatch(negative, /app screen|glowing display|user interface/i);
  assert.doesNotMatch(negative, /amber light|daylight|overcast sky|pale grey backdrop/i);
  assert.doesNotMatch(negative, /silhouette-only character|face hidden by default|hidden eyes/i);
});

test("FLUX local, Cloudflare FLUX, and Gemini receive the same wordless concrete scene", () => {
  const item = { id: "01-playlist", prompt: qwenScene };
  const style = "rough oil and gouache, warm editorial painting";
  for (const prompt of [
    buildFluxPrompt(item, style),
    buildGeminiPrompt(item, style),
  ]) {
    assert.match(prompt, /cracked smartphone screen/i);
    assert.match(prompt, /notification glow on the phone/i);
    assert.match(prompt, /old vinyl record sleeve/i);
    assert.match(prompt, /dim amber glow/i);
    assert.match(prompt, /no readable text/i);
    assert.match(prompt, /artwork is unsigned and unbranded/i);
    assert.match(prompt, /lower corners contain only uninterrupted paint or paper texture/i);
    assert.doesNotMatch(prompt, /message bubble/i);
  }
});

test("ComfyUI uses wordless conversion and negative deconfliction", async () => {
  const source = await fs.readFile(
    path.join(repoRoot, "scripts", "generate-images-local.mjs"),
    "utf8",
  );
  assert.match(source, /makeWordlessVisualPrompt\(item\.prompt\)/);
  assert.match(source, /deconflictNegativePrompt\(positive, negative\)/);
  assert.doesNotMatch(source, /app screen, glowing display, screen content/);
  assert.doesNotMatch(source, /orange glow, amber light, warm sunset/);
});
