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
assert.match(flux.stylePrompt, /rough editorial oil or gouache plate/i);
assert.match(flux.stylePrompt, /broad visible bristle strokes/i);
assert.match(flux.stylePrompt, /sunrise, sunset/i);
assert.doesNotMatch(flux.stylePrompt, /Japanese animated|Ghibli/i);
assert.doesNotMatch(flux.sceneTemplate, /hooded|faceless/i);
assert.deepEqual(
  flux.referencePrompts.map((item) => item.role),
  ["character", "character", "style"],
);
assert.match(flux.referencePrompts[2].prompt, /No people/i);
assert.match(flux.referencePrompts[0].prompt, /broad visible bristle strokes/i);
assert.match(flux.referencePrompts[2].prompt, /brick red/i);

const storybook = styles.find((style) => style.id === "storybook");
const livingStorybook = styles.find((style) => style.id === "living-storybook");
for (const style of [storybook, livingStorybook]) {
  assert.match(style.stylePrompt, /vintage painterly relationship-story illustration/i);
  assert.match(style.stylePrompt, /broad visible bristlework/i);
  assert.match(style.stylePrompt, /medium-long or wide/i);
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
  ["protagonist-a-painted-reference-v4", "sunset-brush-material-reference-v4"],
);
assert.deepEqual(
  referencesForScene({ castMode: "solo-b" }, references).map((item) => item.id),
  ["protagonist-b-painted-reference-v4", "sunset-brush-material-reference-v4"],
);
assert.equal(referencesForScene({ castMode: "pair" }, references).length, 3);

const anime = styles.find((style) => style.id === "anime");
assert.match(anime.sceneTemplate, /\{\{sentiment\}\}/i);
assert.match(anime.sceneTemplate, /\{\{castPlan\}\}/i);
assert.match(anime.stylePrompt, /broad visible bristle strokes/i);
assert.match(anime.stylePrompt, /medium-long and wide/i);
assert.doesNotMatch(anime.stylePrompt, /Japanese animated|Ghibli/i);

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
assert.match(photographic.stylePrompt, /painter's sunset palette/i);
assert.match(photographic.stylePrompt, /medium-long or wide/i);
assert.match(photographic.negativeExtra, /two adult women together/i);
assert.match(photographic.negativeExtra, /two adult men together/i);
assert.match(photographic.negativeExtra, /same-sex couple/i);
assert.match(flatVector.stylePrompt, /rough brush-shaped geometry/i);
assert.match(inkLine.stylePrompt, /broad dry-brush ink masses/i);

// "simple" and "flat-line-poetry" deliberately opt out of every shared invariant below: no
// cast plan, no fixed sunset palette, no couple-continuity rule. They are checked separately
// instead of joining this loop.
for (const style of styles.filter(
  (style) => style.id !== "simple" && style.id !== "flat-line-poetry",
)) {
  assert.match(style.sceneTemplate, /\{\{cast(?:Plan|Brief)\}\}/i);
  assert.match(style.negativeExtra, /two adult women together/i);
  assert.match(style.negativeExtra, /two adult men together/i);
  assert.match(style.negativeExtra, /same-sex couple/i);
  assert.match(style.stylePrompt, /brick red|rust/i);
  assert.match(style.stylePrompt, /sunrise|sunset/i);
  assert.doesNotMatch(style.stylePrompt, /Japanese animated-film|Ghibli/i);
}

const simple = styles.find((style) => style.id === "simple");
assert.equal(simple.provider, "comfyui");
assert.match(simple.sceneTemplate, /\{\{line\}\}/i);
assert.match(simple.sceneTemplate, /\{\{keywordsAll\}\}/i);
assert.doesNotMatch(simple.sceneTemplate, /\{\{cast(?:Plan|Brief)\}\}/i);
assert.doesNotMatch(simple.sceneTemplate, /\{\{shotPlan\}\}/i);
assert.doesNotMatch(simple.negativeExtra, /two adult women together/i);

const flatLinePoetry = styles.find((style) => style.id === "flat-line-poetry");
assert.equal(flatLinePoetry.provider, "flux2-local");
assert.equal(flatLinePoetry.fallbackProvider, "cloudflare-flux2");
assert.equal(flatLinePoetry.postProcess, "paper-grain");
assert.match(flatLinePoetry.sceneTemplate, /\{\{sentiment\}\}/i);
assert.match(flatLinePoetry.sceneTemplate, /\{\{keywordsAll\}\}/i);
assert.doesNotMatch(flatLinePoetry.sceneTemplate, /\{\{cast(?:Plan|Brief)\}\}/i);
assert.match(flatLinePoetry.stylePrompt, /flat-color line art/i);
assert.doesNotMatch(flatLinePoetry.stylePrompt, /brick red|rust/i);
assert.match(flatLinePoetry.negativeExtra, /painterly brushwork/i);

console.log("Story-aware photographic, vector, ink, anime, storybook, FLUX, and reference routing passed.");
