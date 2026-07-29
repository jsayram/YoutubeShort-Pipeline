import assert from "node:assert/strict";
import test from "node:test";
import { loadPromptDocument, buildScenePrompts } from "./prompt-profiles.mjs";
import { DEFAULT_TOPIC_ID, loadTopics, resolveTopic } from "./topics.mjs";

const promptDocument = await loadPromptDocument();
const lines = [
  "Bitcoin left the exchange overnight",
  "the order book kept shrinking",
  "traders remember the last crash",
  "so I stay in cash",
];

test("every topic pack loads and validates", async () => {
  const topics = await loadTopics();
  assert.ok(topics.length >= 2, "expected at least romance and neutral");
  const ids = topics.map((topic) => topic.id);
  assert.ok(ids.includes("romance"));
  assert.ok(ids.includes("neutral"));
  assert.equal(new Set(ids).size, ids.length, "topic ids must be unique");
  await assert.rejects(() => resolveTopic("does-not-exist"), /Unknown topic/);
});

test("romance owns the cast rules that used to be hardcoded in every style", async () => {
  const romance = await resolveTopic("romance");
  assert.equal(romance.cast.mode, "recurring-pair");
  assert.match(romance.cast.pairPlan, /two \{\{age\}\} figures together at medium distance/i);
  assert.match(romance.cast.objectPlan, /No people anywhere in this frame/i);
  // Age is a placeholder in the pack and resolved per-script, so young love is the default
  // and an older cast only appears when the narration actually says so.
  assert.equal(romance.cast.age.default.descriptor, "young adult");
  assert.match(romance.cast.age.safetyNegatives, /child|teenager|minor/i);
  assert.match(romance.negatives, /two \{\{age\}\} women together/i);
  assert.match(romance.negatives, /same-sex couple/i);
  assert.ok(romance.sceneDirectionRules.length > 10, "romance keeps its scene direction rules");
  assert.equal(DEFAULT_TOPIC_ID, "romance", "default stays romance so existing projects are stable");
});

test("neutral imposes no cast, so a non-people topic stays clean", async () => {
  const neutral = await resolveTopic("neutral");
  assert.equal(neutral.cast.mode, "none");
  assert.equal(neutral.negatives, "");
  assert.deepEqual(neutral.sceneDirectionRules, []);
});

// The whole point of the split: the same look profile, driven by a different topic, must not
// smuggle a romantic couple into a script that has nothing to do with one.
test("a cast-less topic leaves no cast text or unresolved variables in any style", async () => {
  const neutral = await resolveTopic("neutral");
  for (const [id, profile] of Object.entries(promptDocument.providers)) {
    const scenes = buildScenePrompts(lines, profile.sceneTemplate, neutral);
    const joined = scenes.map((scene) => scene.prompt).join("\n");
    assert.doesNotMatch(joined, /\{\{/, `${id} left an unresolved variable`);
    assert.doesNotMatch(joined, /adult woman|adult man|static couple|young adult/i, `${id} leaked cast text`);
    assert.doesNotMatch(joined, /\s,|,,/, `${id} left punctuation debris where cast was removed`);
    for (const scene of scenes) assert.ok(scene.prompt.trim().length > 0);
  }
});

test("the same style produces different cast handling per topic", async () => {
  const [romance, neutral] = await Promise.all([resolveTopic("romance"), resolveTopic("neutral")]);
  // Storybook rather than photographic: photographic is the one profile that deliberately takes
  // no cast variables, so it cannot show a per-topic cast difference.
  const template = promptDocument.providers.storybook.sceneTemplate;
  const withCast = buildScenePrompts(lines, template, romance)[0].prompt;
  const withoutCast = buildScenePrompts(lines, template, neutral)[0].prompt;
  assert.match(withCast, /young adult figures|young adult woman|young adult man|No people anywhere/i);
  assert.doesNotMatch(withoutCast, /young adult/i);
  assert.notEqual(withCast, withoutCast);
});
