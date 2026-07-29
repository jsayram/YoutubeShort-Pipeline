import assert from "node:assert/strict";
import { loadStyles } from "./image-styles.mjs";
import {
  buildFluxPrompt,
  promptWithReferences,
  referencesForScene,
  splitImageItems,
} from "./image-worker-common.mjs";

const styles = await loadStyles();
const ids = styles.map((style) => style.id);
assert.equal(new Set(ids).size, ids.length, "Content provider ids must be unique.");

// loadStyles reports a style whose prompt profile was deleted as `broken` instead of throwing,
// so retiring one style cannot take the whole catalogue down. Nothing shipped should be broken.
const orphaned = styles.filter((style) => style.broken);
assert.deepEqual(orphaned.map((style) => style.id), [], "style(s) reference a missing prompt profile");

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
}
assert.match(photographic.stylePrompt, /cinematic editorial photography/i);
assert.match(photographic.stylePrompt, /painter's sunset palette/i);
assert.match(photographic.stylePrompt, /medium-long or wide/i);
assert.match(flatVector.stylePrompt, /rough brush-shaped geometry/i);
assert.match(inkLine.stylePrompt, /broad dry-brush ink masses/i);

// Cast rules and the shared sunset palette are NOT style invariants any more. Cast now belongs
// to the topic pack (templates/topics/*.json) and is asserted in topics.test.mjs, which is what
// lets one look serve romance, crypto, or animals. What every style still owes is a usable
// template and a negative prompt that suppresses lettering.
for (const style of styles) {
  assert.match(style.sceneTemplate, /\{\{line\}\}|\{\{keywords/i, `${style.id} needs the narration line`);
  assert.match(style.negativeExtra, /text|letters|watermark/i, `${style.id} needs text negatives`);
  assert.doesNotMatch(
    style.negativeExtra,
    /two adult women together|same-sex couple|static matched couple/i,
    `${style.id} still carries topic-specific cast negatives`,
  );
}

const simple = styles.find((style) => style.id === "simple");
assert.equal(simple.provider, "comfyui");
assert.match(simple.sceneTemplate, /\{\{line\}\}/i);
assert.match(simple.sceneTemplate, /\{\{keywordsAll\}\}/i);
assert.doesNotMatch(simple.sceneTemplate, /\{\{cast(?:Plan|Brief)\}\}/i);
assert.doesNotMatch(simple.sceneTemplate, /\{\{shotPlan\}\}/i);
assert.doesNotMatch(simple.negativeExtra, /two adult women together/i);

const flatLinePoetry = styles.find((style) => style.id === "flat-line-poetry");
// Moved off FLUX deliberately: FLUX zeroes its negative conditioning and runs at guidance 1,
// so negativePrompt never reaches the model. This look depends on suppressing panels and
// lettering, which only works on an SDXL checkpoint with real classifier-free guidance.
assert.equal(flatLinePoetry.provider, "comfyui");
assert.deepEqual(flatLinePoetry.prefersCheckpoint, ["illustrious"]);
assert.equal(flatLinePoetry.postProcess, "paper-grain");
assert.match(flatLinePoetry.sceneTemplate, /\{\{sentiment\}\}/i);
assert.match(flatLinePoetry.sceneTemplate, /\{\{keywordsAll\}\}/i);
assert.match(flatLinePoetry.sceneTemplate, /\{\{shotPlan\}\}/i);
assert.match(flatLinePoetry.sceneTemplate, /\{\{visualAction\}\}/i);
assert.match(flatLinePoetry.sceneTemplate, /\{\{castPlan\}\}/i);
// {{storyBeat}} is deliberately absent: "opening and first encounter" is narrative meta with
// nothing to draw, and this checkpoint reads tags rather than prose.
assert.doesNotMatch(flatLinePoetry.sceneTemplate, /\{\{storyBeat\}\}/i);
assert.match(flatLinePoetry.stylePrompt, /flat-color screenprint/i);
assert.match(flatLinePoetry.stylePrompt, /textured paper/i);
assert.match(flatLinePoetry.negativeExtra, /anime face|character sheet/i);
assert.doesNotMatch(flatLinePoetry.stylePrompt, /brick red|rust/i);
assert.doesNotMatch(flatLinePoetry.negativeExtra, /detailed visible face/i);
assert.match(flatLinePoetry.negativeExtra, /anime|comic panel/i);

// FLUX's ComfyUI workflow zeroes out its negative conditioning and runs at guidance 1, so
// negativePrompt never reaches the model there — the only way to keep a quoted, dialogue-like
// narration line from being rendered as a literal speech bubble or comic panel is a hard positive
// instruction baked into every FLUX prompt, regardless of style.
const fluxPrompt = buildFluxPrompt(
  { prompt: "They say you can't go back" },
  "warm sunset gradient",
);
assert.match(fluxPrompt, /no readable text/i);
assert.match(fluxPrompt, /speech bubbles/i);
assert.match(fluxPrompt, /comic strip or multi-panel/i);
assert.match(fluxPrompt, /They say you can't go back/);

console.log("Story-aware photographic, vector, ink, anime, storybook, FLUX, and reference routing passed.");
