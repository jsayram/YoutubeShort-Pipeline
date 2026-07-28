import assert from "node:assert/strict";
import { loadStyles } from "./image-styles.mjs";
import {
  promptWithReferences,
  referencesForScene,
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
assert.equal(flux.referencePrompts.length, 3);
assert.match(flux.sceneTemplate, /interpret the full sentence as a story event/i);
assert.match(flux.stylePrompt, /oil-and-paper-watercolor romance storybook/i);
assert.match(flux.stylePrompt, /cold-press paper/i);
assert.doesNotMatch(flux.sceneTemplate, /hooded|faceless/i);
assert.deepEqual(
  flux.referencePrompts.map((item) => item.role),
  ["character", "character", "style"],
);
assert.match(flux.referencePrompts[2].prompt, /No people/i);

const storybook = styles.find((style) => style.id === "storybook");
const livingStorybook = styles.find((style) => style.id === "living-storybook");
for (const style of [storybook, livingStorybook]) {
  assert.match(style.stylePrompt, /vintage oil-and-paper-watercolor storybook/i);
  assert.match(style.stylePrompt, /expressive adult faces/i);
  assert.match(style.sceneTemplate, /\{\{castPlan\}\}/i);
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
assert.deepEqual(references.map((item) => item.role), ["character", "character", "style"]);
assert.deepEqual(scenes.map((item) => item.id), ["01-scene"]);
const referencedPrompt = promptWithReferences("A traveler waits.", references);
assert.match(referencedPrompt, /reference image 1/i);
assert.match(referencedPrompt, /reference image 2/i);
assert.match(referencedPrompt, /reference image 3/i);
assert.match(referencedPrompt, /do not copy its pose or background/i);
assert.doesNotMatch(referencedPrompt, /hidden face/i);
assert.deepEqual(
  referencesForScene({ castMode: "solo-a" }, references).map((item) => item.id),
  ["protagonist-a-reference-v3", "nostalgic-material-reference-v3"],
);
assert.deepEqual(
  referencesForScene({ castMode: "solo-b" }, references).map((item) => item.id),
  ["protagonist-b-reference-v3", "nostalgic-material-reference-v3"],
);
assert.equal(referencesForScene({ castMode: "pair" }, references).length, 3);

const anime = styles.find((style) => style.id === "anime");
assert.match(anime.sceneTemplate, /\{\{sentiment\}\}/i);
assert.match(anime.sceneTemplate, /\{\{castPlan\}\}/i);
assert.match(anime.stylePrompt, /paper watercolor/i);

console.log("FLUX, Cloudflare, Animagine, Gemini, and reference routing passed.");
