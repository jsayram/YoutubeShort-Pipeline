import assert from "node:assert/strict";
import { loadStyles } from "./image-styles.mjs";
import {
  buildFluxPrompt,
  promptWithReferences,
  referencesForScene,
  splitImageItems,
  styleForScene,
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
  "pastel-watercolor-ink",
  "flux2-pastel-watercolor-ink",
  "cloudflare-flux2-pastel-watercolor-ink",
  "drawthings-oil-gouache",
  "animagine-dark-storybook",
  "pixazo-sdxl-watercolor",
  "krea2-photographic",
  "gemini",
  "gemini-pastel-watercolor-ink",
]) {
  assert.ok(ids.includes(required), `Missing content provider ${required}.`);
}

const flux = styles.find((style) => style.id === "flux2-storybook");
assert.equal(flux.provider, "flux2-local");
assert.equal(flux.fallbackProvider, "cloudflare-flux2");
assert.equal(flux.requiredModels.diffusionModel, "flux-2-klein-4b.safetensors");
assert.equal(flux.referencePrompts.length, 3);
assert.match(flux.sceneTemplate, /interpret the full sentence as one readable story event/i);
assert.match(flux.stylePrompt, /poetic comic-book illustration/i);
assert.match(flux.stylePrompt, /layered paper shapes/i);
assert.match(flux.stylePrompt, /controlled warm-dark palette/i);
assert.doesNotMatch(flux.stylePrompt, /Japanese animated|Ghibli/i);
assert.doesNotMatch(flux.sceneTemplate, /hooded|faceless/i);
assert.deepEqual(
  flux.referencePrompts.map((item) => item.role),
  ["character", "character", "style"],
);
assert.match(flux.referencePrompts[2].prompt, /No person/i);
assert.match(flux.referencePrompts[0].prompt, /simplified paper-cut figure/i);
assert.match(flux.referencePrompts[2].prompt, /burnt umber/i);

const pixazo = styles.find((style) => style.id === "pixazo-sdxl-watercolor");
assert.equal(pixazo.provider, "pixazo-sdxl");
assert.equal(pixazo.promptProfile, "pastel-watercolor-ink");
assert.equal(pixazo.sampling.numSteps, 20);
assert.equal(pixazo.sampling.guidanceScale, 5);
assert.equal(pixazo.framing.genWidth, 1024);
assert.equal(pixazo.framing.genHeight, 576);
assert.match(pixazo.stylePrompt, /editorial watercolor-and-ink storybook illustration/i);
assert.match(pixazo.stylePrompt, /untouched white paper/i);
assert.match(pixazo.negativeExtra, /text, letters, words, numbers/i);

const krea2 = styles.find((style) => style.id === "krea2-photographic");
assert.equal(krea2.provider, "krea2-local");
assert.equal(krea2.fallbackProvider, undefined);
assert.equal(krea2.requiredModels.diffusionModel, "krea2_turbo_bf16.safetensors");
assert.equal(krea2.requiredModels.textEncoder, "qwen3vl_4b_fp8_scaled.safetensors");
assert.equal(krea2.requiredModels.vae, "qwen_image_vae.safetensors");
assert.equal(krea2.sampling.steps, 8);
assert.equal(krea2.sampling.guidance, 1);
assert.equal(krea2.referencePrompts, undefined);

const watercolor = styles.find((style) => style.id === "pastel-watercolor-ink");
const fluxWatercolor = styles.find((style) => style.id === "flux2-pastel-watercolor-ink");
const cloudflareWatercolor = styles.find(
  (style) => style.id === "cloudflare-flux2-pastel-watercolor-ink",
);
const geminiWatercolor = styles.find((style) => style.id === "gemini-pastel-watercolor-ink");
for (const style of [watercolor, fluxWatercolor, cloudflareWatercolor, geminiWatercolor]) {
  assert.equal(style.promptProfile, "pastel-watercolor-ink");
  assert.match(style.stylePrompt, /bright white cold-pressed watercolor paper/i);
  assert.match(style.stylePrompt, /transparent layered watercolor washes/i);
  assert.match(style.stylePrompt, /blush pink, coral, peach/i);
  assert.match(style.stylePrompt, /untouched white paper/i);
  assert.doesNotMatch(style.stylePrompt, /couple|romance|relationship/i);
  assert.match(style.sceneTemplate, /continue a prop or setting across adjacent beats/i);
}
assert.equal(watercolor.provider, "comfyui");
assert.equal(fluxWatercolor.provider, "flux2-local");
assert.equal(fluxWatercolor.fallbackProvider, "cloudflare-flux2");
assert.equal(fluxWatercolor.sampling.guidance, 2.5);
assert.equal(cloudflareWatercolor.provider, "cloudflare-flux2");
assert.equal(cloudflareWatercolor.sampling.guidance, 2.5);
assert.equal(geminiWatercolor.provider, "gemini");
for (const style of [watercolor, fluxWatercolor, cloudflareWatercolor]) {
  assert.equal(style.referencePrompts.length, 1);
  assert.equal(style.referencePrompts[0].role, "style");
  assert.match(style.referencePrompts[0].prompt, /abstract material study/i);
  assert.doesNotMatch(style.referencePrompts[0].prompt, /couple|romance|relationship/i);
}

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
const animagineLofi = styles.find((style) => style.id === "animagine-lofi-melancholy");
const flatLinePoetry = styles.find((style) => style.id === "flat-line-poetry");
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
assert.equal(animagine.framing.genWidth, 1024);
assert.equal(animagine.framing.genHeight, 1024);

assert.equal(animagineLofi.provider, "comfyui");
assert.equal(animagineLofi.promptProfile, "animagine-lofi-melancholy");
assert.equal(animagineLofi.postProcess, "paper-grain");
assert.equal(animagineLofi.sampling.steps, 28);
assert.equal(animagineLofi.sampling.cfg, 6);
assert.equal(animagineLofi.sampling.sampler, "euler_ancestral");
assert.equal(animagineLofi.sampling.styleSeed, 1959877624);
assert.equal(animagineLofi.framing.genWidth, 1344);
assert.equal(animagineLofi.framing.genHeight, 768);
assert.equal(animagineLofi.framing.outWidth, 1920);
assert.equal(animagineLofi.framing.outHeight, 1080);
assert.equal(animagineLofi.styleStudies.length, 3);
assert.equal(animagineLofi.referencePrompts, undefined);
assert.match(animagineLofi.stylePrompt, /hand-drawn anime illustration/i);
assert.match(animagineLofi.stylePrompt, /bold sketch-like black linework/i);
assert.match(animagineLofi.stylePrompt, /heavy visible coarse film grain/i);
assert.match(animagineLofi.stylePrompt, /twenty percent rust orange deep amber/i);
assert.match(animagineLofi.stylePrompt, /ten percent muted deep teal/i);
assert.match(animagineLofi.stylePrompt, /wide horizontal framing/i);
assert.match(animagineLofi.negativeExtra, /multi-panel layout/i);
assert.match(animagineLofi.negativeExtra, /readable text/i);

const illustriousAcrylic = styles.find(
  (style) => style.id === "illustrious-acrylic-melancholy",
);
const fluxAcrylic = styles.find((style) => style.id === "flux2-acrylic-melancholy");
const drawThingsPainterly = styles.find((style) => style.id === "drawthings-oil-gouache");
assert.equal(illustriousAcrylic.provider, "comfyui");
assert.equal(illustriousAcrylic.promptProfile, "acrylic-melancholy-tags");
assert.match(illustriousAcrylic.stylePrompt, /heavy impasto brushstrokes/i);
assert.match(illustriousAcrylic.stylePrompt, /deep emerald green/i);
assert.match(illustriousAcrylic.stylePrompt, /frayed comic-paper edge/i);
assert.equal(illustriousAcrylic.postProcess, "paper-grain");
assert.equal(drawThingsPainterly.provider, "drawthings");
assert.equal(drawThingsPainterly.drawThingsModel, "illustrious_xl_v2.0_f16.ckpt");
assert.equal(drawThingsPainterly.sampling.steps, 30);
assert.equal(drawThingsPainterly.sampling.guidanceScale, 5.5);
assert.equal(drawThingsPainterly.sampling.sampler, "Euler A AYS");
assert.equal(drawThingsPainterly.sampling.shift, 1);
assert.equal(drawThingsPainterly.sampling.clipSkip, 2);
assert.equal(drawThingsPainterly.framing.genWidth, 1024);
assert.equal(drawThingsPainterly.framing.genHeight, 576);
assert.equal(drawThingsPainterly.loras[0].weight, 0.65);
assert.match(drawThingsPainterly.stylePrompt, /oil painting/i);
assert.match(drawThingsPainterly.stylePrompt, /gouache painting/i);
assert.match(drawThingsPainterly.negativeExtra, /lime green/i);
assert.equal(fluxAcrylic.provider, "flux2-local");
assert.equal(fluxAcrylic.promptProfile, "acrylic-melancholy-prose");
assert.match(fluxAcrylic.stylePrompt, /heavy impasto brushstrokes/i);
assert.match(fluxAcrylic.summary, /prompt conditioning only/i);
assert.equal(fluxAcrylic.loras, undefined);
assert.equal(fluxAcrylic.postProcess, "acrylic-unsigned");

// FLUX and Illustrious share the literal cut-paper contract.
for (const style of [flux, flatLinePoetry]) {
  assert.match(style.stylePrompt, /paper/i, `${style.id} must keep visible paper material`);
  assert.match(
    style.stylePrompt,
    /paper-cut|cut-paper/i,
    `${style.id} must simplify figures and shapes as cut paper`,
  );
  assert.match(style.stylePrompt, /burnt umber/i, `${style.id} must share the warm-dark palette`);
  assert.match(style.stylePrompt, /charcoal/i, `${style.id} must share the warm-dark palette`);
  assert.match(style.stylePrompt, /amber light/i, `${style.id} must make warm light dominant`);
  assert.match(style.negativeExtra, /photorealistic|photograph/i);
  assert.match(style.negativeExtra, /dominant blue lighting|cold cyan wash/i);
  assert.match(style.negativeExtra, /panel border|multi-panel/i);
}
assert.match(animagine.stylePrompt, /rough oil and gouache/i);
assert.match(animagine.stylePrompt, /coarse paper/i);
assert.match(animagine.stylePrompt, /deep burnt umber and charcoal/i);
assert.match(animagine.negativeExtra, /photorealistic|photograph/i);
assert.equal(referencesForScene({ castMode: "object" }, animagine.referencePrompts).length, 1);
assert.equal(referencesForScene({ castMode: "solo-a" }, animagine.referencePrompts).length, 1);
assert.equal(referencesForScene({ castMode: "pair" }, animagine.referencePrompts).length, 1);

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
  ["protagonist-a-paper-comic-reference-v6", "warm-dark-paper-comic-material-reference-v6"],
);
assert.deepEqual(
  referencesForScene({ castMode: "solo-b" }, references).map((item) => item.id),
  ["protagonist-b-paper-comic-reference-v6", "warm-dark-paper-comic-material-reference-v6"],
);
assert.equal(referencesForScene({ castMode: "pair" }, references).length, 3);
assert.deepEqual(
  referencesForScene({ castMode: "none" }, references).map((item) => item.role),
  ["style"],
);
assert.deepEqual(
  referencesForScene({ castMode: "object" }, references).map((item) => item.role),
  ["style"],
);

const anime = styles.find((style) => style.id === "anime");
assert.match(anime.sceneTemplate, /\{\{sentiment\}\}/i);
assert.match(anime.sceneTemplate, /\{\{castPlan\}\}/i);
assert.match(anime.stylePrompt, /broad visible bristle strokes/i);
assert.match(anime.stylePrompt, /medium-long and wide/i);
assert.doesNotMatch(anime.stylePrompt, /Japanese animated|Ghibli/i);

const photographic = styles.find((style) => style.id === "photographic");
const flatVector = styles.find((style) => style.id === "flat-vector");
const inkLine = styles.find((style) => style.id === "ink-line");
for (const style of [flatVector, inkLine]) {
  assert.match(style.sceneTemplate, /\{\{line\}\}/i);
  assert.match(style.sceneTemplate, /\{\{sentiment\}\}/i);
  assert.match(style.sceneTemplate, /\{\{storyBeat\}\}/i);
  assert.match(style.sceneTemplate, /\{\{visualAction\}\}/i);
  assert.match(style.sceneTemplate, /\{\{shotPlan\}\}/i);
  assert.match(style.sceneTemplate, /\{\{castPlan\}\}/i);
  assert.match(style.sceneTemplate, /\{\{continuity\}\}/i);
}

// Photographic is deliberately the one unpeopled look: retro film stills of places and objects.
// It keeps the narration, the emotion, and the scene-to-scene variety, but drops every cast and
// staging variable, because a topic pack's direction ("close over-the-shoulder detail built
// around the cup, hands") is exactly what this style must not receive.
assert.match(photographic.sceneTemplate, /\{\{line\}\}/i);
assert.match(photographic.sceneTemplate, /\{\{sentiment\}\}/i);
assert.match(photographic.sceneTemplate, /\{\{storyBeat\}\}/i);
assert.match(photographic.sceneTemplate, /\{\{continuity\}\}/i);
for (const variable of ["castPlan", "castBrief", "castTags", "visualAction", "shotPlan", "topicDirection"]) {
  assert.doesNotMatch(
    photographic.sceneTemplate,
    new RegExp(`\\{\\{${variable}\\}\\}`),
    `photographic must not take {{${variable}}}; it would stage people`,
  );
}
assert.match(photographic.sceneTemplate, /no people in it/i);
assert.match(photographic.sceneTemplate, /no visible face, no visible hands/i);
assert.match(photographic.sceneTemplate, /different primary object and a different setting/i);
assert.match(photographic.stylePrompt, /old grainy 35mm camera/i);
assert.match(photographic.stylePrompt, /varied locations and times of day/i);
assert.match(photographic.negativeExtra, /portrait, face/i);
assert.match(photographic.negativeExtra, /hands, fingers/i);
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
assert.match(flatLinePoetry.stylePrompt, /poetic comic-book illustration/i);
assert.match(flatLinePoetry.stylePrompt, /paper grain and fibre/i);
assert.match(flatLinePoetry.compactStylePrompt, /matte screenprint ink/i);
assert.doesNotMatch(flatLinePoetry.compactStylePrompt, /gradient sky|gradient background/i);
assert.match(flatLinePoetry.negativeExtra, /anime face|character sheet/i);
assert.match(flatLinePoetry.stylePrompt, /oxblood rust/i);
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
const fluxObjectPrompt = buildFluxPrompt(
  { prompt: "A phone on a nightstand", castMode: "object" },
  "warm paper comic",
);
assert.match(fluxObjectPrompt, /object-only still life in an unoccupied setting/i);
const objectStyle = styleForScene(
  { castMode: "object" },
  "warm paper, simplified figure, abstract shapes, paper-cut silhouettes, amber light",
);
assert.equal(objectStyle, "warm paper, abstract shapes, amber light");

console.log("Story-aware photographic, vector, ink, anime, storybook, FLUX, and reference routing passed.");
