import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAuthoritativePrompt,
  buildSystemPrompt,
  buildUserPrompt,
  detectFormat,
  detectProviderCategory,
  reconstructPrompt,
  sceneConstraints,
} from "./enrich-prompts.mjs";

test("natural-language enrichment preserves framing and replaces old anchors", () => {
  const original =
    "Photograph the feeling of this narration beat as an empty scene with no people in it. " +
    "Narration: They say you can't go back. Story position: opening. " +
    "Visual anchors: tonight, proving, wrong. " +
    "Scene 1 of 12, with its own distinct location, camera distance, and light. " +
    "Build the horizontal frame from layered foreground and background depth.";
  const scene =
    "A worn leather suitcase sits open on a rain-soaked train platform bench. " +
    "Early morning fog softens the distant tracks.";

  const result = reconstructPrompt(original, scene, "prose");
  assert.match(result, /Photograph the feeling/);
  assert.match(result, /no people in it/);
  assert.match(result, /worn leather suitcase/);
  assert.match(result, /Scene 1 of 12/);
  assert.match(result, /Build the horizontal frame/);
  assert.doesNotMatch(result, /Visual anchors:/);
  assert.doesNotMatch(result, /tonight, proving, wrong/);
});

test("FLUX natural-language enrichment recognizes Literal anchors", () => {
  const original =
    "Paint this exact beat. Literal anchors: coffee, waiting, silence. " +
    "Scene 4 of 8 uses a distinct composition. Keep broad brushwork and warm shadow.";
  const result = reconstructPrompt(
    original,
    "Two cooling coffee cups sit across from each other in a nearly empty station café.",
    "prose",
  );
  assert.match(result, /Two cooling coffee cups/);
  assert.match(result, /Scene 4 of 8/);
  assert.match(result, /broad brushwork/);
  assert.doesNotMatch(result, /Literal anchors:/);
});

test("tag enrichment adds concrete scene tags without removing provider style tags", () => {
  const original =
    "safe, solo woman, visual anchors waiting phone night, shot design medium-wide, " +
    "rough watercolor paper, masterpiece";
  const result = reconstructPrompt(
    original,
    "cracked phone screen, empty bus shelter, blue-hour rain, wet concrete",
    "tags",
  );
  assert.match(result, /cracked phone screen/);
  assert.match(result, /empty bus shelter/);
  assert.match(result, /rough watercolor paper/);
  assert.match(result, /masterpiece/);
});

test("missing markers fall back without discarding the original prompt", () => {
  const original = "A simple prompt without the expected structure.";
  const result = reconstructPrompt(original, "A cracked ceramic mug.", "prose");
  assert.match(result, /cracked ceramic mug/);
  assert.match(result, /simple prompt without/);
});

test("provider category and format are derived without changing provider templates", () => {
  const noPeople = {
    format: "natural-language",
    sceneTemplate: "Create a scene with no people in it.",
  };
  const people = {
    format: "ordered-tags",
    sceneTemplate: "Show {{castPlan}} and {{visualAction}}.",
  };
  const symbolic = {
    format: "style-tags",
    sceneTemplate: "Create a symbolic, non-literal composition.",
  };

  assert.equal(detectProviderCategory(noPeople), "no-people");
  assert.equal(detectProviderCategory(people), "people");
  assert.equal(detectProviderCategory(symbolic), "symbolic");
  assert.equal(detectFormat(noPeople), "prose");
  assert.equal(detectFormat(people), "tags");
  assert.match(buildSystemPrompt(noPeople), /NO people, faces, hands/);
  assert.match(buildSystemPrompt(people), /objects only, one person, or multiple people/);
  assert.match(buildSystemPrompt(people), /soft notification glow/);
  assert.match(buildSystemPrompt(people), /heart is optional, never required/i);
  assert.match(buildSystemPrompt(symbolic), /abstract shapes/);
});

test("creative archetype enrichment treats narration as an emotional seed", () => {
  const profile = {
    format: "ordered-tags",
    enrichmentMode: "creative-archetype",
    enrichmentGuide: "Favor quiet secrecy.",
    sceneTemplate: "Show {{castPlan}} in one wordless scene.",
    stylePrompt: "hand-drawn lo-fi anime, heavy grain",
    sceneArchetypes: [
      "solitary figure in a deep-perspective alley",
      "back-view figure beneath a vast sunset sky",
      "quiet candlelit interior",
    ],
  };
  const system = buildSystemPrompt(profile);
  assert.match(system, /EMOTIONAL SEED/i);
  assert.match(system, /may depart from the narration's literal nouns/i);
  assert.match(system, /Rotate families/i);
  assert.match(system, /solitary figure in a deep-perspective alley/i);
  assert.match(system, /drawing medium, grain, and global palette are appended later/i);
  assert.doesNotMatch(system, /Preserve every concrete object explicitly named/i);

  const user = buildUserPrompt(
    {
      prompt: "emotional interpretation grief, required visual event a phone on a table",
      castMode: "object",
    },
    0,
    2,
    ["I still have your old playlist.", "Sometimes I almost text you."],
    [],
    "tags",
    profile,
  );
  assert.match(user, /inspired by the emotion, not a literal illustration/i);
  assert.match(user, /fresh cinematic scene/i);
  assert.match(user, /wordless horizontal scene/i);
  assert.doesNotMatch(user, /Preserve every physical object/i);
});

test("authoritative enrichment lets the concrete Qwen scene replace a competing draft plan", () => {
  const item = {
    id: "01-playlist",
    castMode: "pair",
    prompt:
      "safe, emotional interpretation grief, exactly two older adults, " +
      "required visual event Two figures stand together at a window, " +
      "shot design Medium-wide view, visual anchors old, playlist, phone, " +
      "unrelated generic relationship staging",
  };
  const constraints = sceneConstraints(item);
  assert.match(constraints.castRule, /Exactly two recurring older adults/i);

  const result = buildAuthoritativePrompt({
    item,
    narration: "I still have your old playlist saved on my phone.",
    scene:
      "cracked smartphone screen, dusty wooden table, old vinyl record sleeve, " +
      "rain-streaked window, dim amber glow, cold gray morning",
    format: "tags",
  });
  assert.match(result, /authoritative concrete scene/i);
  assert.match(result, /cracked smartphone screen/i);
  assert.match(result, /old vinyl record sleeve/i);
  assert.match(result, /dim amber glow/i);
  assert.doesNotMatch(result, /Exactly two recurring older adults/i);
  assert.doesNotMatch(result, /Two figures stand together/i);
  assert.doesNotMatch(result, /Medium-wide view/i);
  assert.doesNotMatch(result, /unrelated generic relationship staging/i);
  assert.ok(result.length < item.prompt.length + 200);
});
