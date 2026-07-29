import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSystemPrompt,
  detectFormat,
  detectProviderCategory,
  reconstructPrompt,
} from "./enrich-prompts.mjs";

test("natural-language enrichment preserves framing and replaces old anchors", () => {
  const original =
    "Photograph the feeling of this narration beat as an empty scene with no people in it. " +
    "Narration: They say you can't go back. Story position: opening. " +
    "Visual anchors: tonight, proving, wrong. " +
    "Scene 1 of 12, with its own distinct location, camera distance, and light. " +
    "Build the vertical frame from layered foreground and background depth.";
  const scene =
    "A worn leather suitcase sits open on a rain-soaked train platform bench. " +
    "Early morning fog softens the distant tracks.";

  const result = reconstructPrompt(original, scene, "prose");
  assert.match(result, /Photograph the feeling/);
  assert.match(result, /no people in it/);
  assert.match(result, /worn leather suitcase/);
  assert.match(result, /Scene 1 of 12/);
  assert.match(result, /Build the vertical frame/);
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
  assert.match(buildSystemPrompt(people), /posture/);
  assert.match(buildSystemPrompt(symbolic), /abstract shapes/);
});
