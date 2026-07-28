import assert from "node:assert/strict";
import { loadStyles } from "./image-styles.mjs";
import {
  promptWithReferences,
  splitImageItems,
} from "./image-worker-common.mjs";

const styles = await loadStyles();
const ids = styles.map((style) => style.id);
assert.equal(new Set(ids).size, ids.length, "Content provider ids must be unique.");

for (const required of [
  "flux2-storybook",
  "cloudflare-flux2-storybook",
  "animagine-dark-storybook",
  "gemini",
]) {
  assert.ok(ids.includes(required), `Missing content provider ${required}.`);
}

const flux = styles.find((style) => style.id === "flux2-storybook");
assert.equal(flux.provider, "flux2-local");
assert.equal(flux.fallbackProvider, "cloudflare-flux2");
assert.equal(flux.requiredModels.diffusionModel, "flux-2-klein-4b.safetensors");
assert.equal(flux.referencePrompts.length, 2);
assert.match(flux.sceneTemplate, /recurring contemporary adult protagonist/i);
assert.match(flux.stylePrompt, /nostalgic hand-drawn romance storybook/i);
assert.match(flux.stylePrompt, /matte flat color blocks/i);
assert.doesNotMatch(flux.sceneTemplate, /hooded|faceless/i);

const storybook = styles.find((style) => style.id === "storybook");
const livingStorybook = styles.find((style) => style.id === "living-storybook");
for (const style of [storybook, livingStorybook]) {
  assert.match(style.stylePrompt, /vintage oil-painted storybook/i);
  assert.match(style.stylePrompt, /expressive adult faces/i);
  assert.match(style.sceneTemplate, /loving couple/i);
  assert.match(style.negativeExtra, /faceless/i);
}
assert.equal(livingStorybook.compositionPreset, "living-storybook");
assert.match(livingStorybook.stylePrompt, /motion-ready staging/i);

const animagine = styles.find((style) => style.id === "animagine-dark-storybook");
assert.equal(animagine.provider, "comfyui");
assert.match(animagine.sceneTemplate, /face completely obscured/i);
assert.match(animagine.negativeExtra, /visible face/i);

const { references, scenes } = splitImageItems(
  [{ id: "01-scene", prompt: "A traveler waits." }],
  flux,
);
assert.deepEqual(references.map((item) => item.role), ["cast", "style"]);
assert.deepEqual(scenes.map((item) => item.id), ["01-scene"]);
assert.match(promptWithReferences("A traveler waits.", references), /reference image 1/i);
assert.match(promptWithReferences("A traveler waits.", references), /reference image 2/i);

console.log("FLUX, Cloudflare, Animagine, Gemini, and reference routing passed.");
