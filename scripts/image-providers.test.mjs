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
assert.match(animagine.sceneTemplate, /Illustrate this exact narration: \{\{line\}\}/i);
assert.match(animagine.sceneTemplate, /\{\{visualAction\}\}/i);
assert.match(animagine.sceneTemplate, /\{\{castBrief\}\}/i);
assert.doesNotMatch(animagine.sceneTemplate, /\{\{keywords\}\}/i);
assert.doesNotMatch(animagine.sceneTemplate, /hooded traveler|full body|centered subject/i);
assert.match(animagine.negativeExtra, /repeated hooded traveler/i);
assert.equal(animagine.referencePrompts.length, 1);
assert.equal(animagine.referencePrompts[0].role, "style");
assert.match(animagine.referencePrompts[0].prompt, /no person/i);
assert.equal(animagine.sampling.referenceWeight, 0.35);

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

const photographic = styles.find((style) => style.id === "photographic");
const flatVector = styles.find((style) => style.id === "flat-vector");
const inkLine = styles.find((style) => style.id === "ink-line");
for (const style of [photographic, flatVector, inkLine]) {
  assert.match(style.sceneTemplate, /\{\{line\}\}/i);
  assert.match(style.sceneTemplate, /\{\{sentiment\}\}/i);
  assert.match(style.sceneTemplate, /\{\{storyBeat\}\}/i);
  assert.match(style.sceneTemplate, /\{\{visualAction\}\}/i);
  assert.match(style.sceneTemplate, /\{\{shotPlan\}\}/i);
  assert.match(style.sceneTemplate, /\{\{castPlan\}\}/i);
  assert.match(style.sceneTemplate, /\{\{continuity\}\}/i);
  assert.match(style.negativeExtra, /static matched couple/i);
}
assert.match(photographic.stylePrompt, /cinematic editorial photography/i);
assert.match(photographic.negativeExtra, /two adult women together/i);
assert.match(photographic.negativeExtra, /two adult men together/i);
assert.match(photographic.negativeExtra, /same-sex couple/i);
assert.match(flatVector.stylePrompt, /flat-vector relationship storybook/i);
assert.match(inkLine.stylePrompt, /cold-press ivory paper grain/i);

for (const style of styles) {
  assert.match(style.sceneTemplate, /\{\{cast(?:Plan|Brief)\}\}/i);
  assert.match(style.negativeExtra, /two adult women together/i);
  assert.match(style.negativeExtra, /two adult men together/i);
  assert.match(style.negativeExtra, /same-sex couple/i);
}

console.log("Story-aware photographic, vector, ink, anime, storybook, FLUX, and reference routing passed.");
