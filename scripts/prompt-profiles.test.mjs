import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildScenePrompts,
  imagePromptsPath,
  loadPromptDocument,
  promoteProviderDefault,
  regenerateProjectScenePrompts,
  resetProjectPromptOverride,
  resolveProjectPromptProfile,
  restoreProviderDefault,
  saveProjectPromptOverride,
  saveScenePrompts,
} from "./prompt-profiles.mjs";
import { resolveTopic } from "./topics.mjs";

const breakupLines = [
  "She stopped asking if I made it home.",
  "I blamed the job that always exhausted her.",
  "Then her replies became hours, then entire days.",
  "I kept shrinking, hoping she would notice me again.",
  "One night, I finally stopped reaching for her.",
  "She texted instantly, asking why I seemed distant.",
  "That was when I understood what we had become.",
  "She only missed me when I started leaving.",
];
const livePromptDocument = await loadPromptDocument();
// These assertions describe romance behavior specifically, so they pass the romance pack
// explicitly rather than relying on whatever the default topic happens to be.
const romanceTopic = await resolveTopic("romance");
const animagineScenes = buildScenePrompts(
  breakupLines,
  livePromptDocument.providers["animagine-dark-storybook"].sceneTemplate,
  romanceTopic,
);
for (const [index, scene] of animagineScenes.entries()) {
  assert.ok(scene.prompt.includes(breakupLines[index].replace(/[,.!?;:]+$/, "")));
  assert.ok(scene.prompt.length < 800, "Animagine prompts should stay concise.");
  assert.doesNotMatch(scene.prompt, /hooded traveler|charcoal hooded coat/i);
}
assert.match(
  animagineScenes[0].prompt,
  /two young adult figures at medium distance, silhouetted/i,
);
assert.match(animagineScenes[0].prompt, /dark home doorway/i);
assert.match(animagineScenes[1].prompt, /late workplace light/i);
assert.match(animagineScenes[2].prompt, /calendar pages/i);
assert.match(animagineScenes[3].prompt, /oversized room/i);
assert.match(animagineScenes[4].prompt, /face-down phone/i);
assert.match(animagineScenes[5].prompt, /phone suddenly lights/i);
assert.match(animagineScenes[6].prompt, /reflection split by a doorway/i);
assert.match(animagineScenes[7].prompt, /crosses a doorway carrying a small bag/i);

const relationshipLines = [
  "We met on an ordinary Tuesday, and nothing about it felt special.",
  "You laughed at something I said, and I forgot what I was saying.",
  "We stayed up too late talking about everything and nothing at all.",
  "I noticed your coffee order long before I ever noticed I loved you.",
  "We fought once over something small, and making up felt like coming home.",
  "You fall asleep before me, and I lie there thinking how lucky I am.",
  "Nobody tells you love is not fireworks. It is just quietly wanting to stay.",
  "So I stay, and every single day I make the choice to stay.",
];
const interpreted = buildScenePrompts(
  relationshipLines,
  [
    "{{storyBeat}}",
    "{{line}}",
    "{{sentiment}}",
    "{{visualAction}}",
    "{{shotPlan}}",
    "{{castPlan}}",
    "{{continuity}}",
  ].join(" | "),
  romanceTopic,
);
assert.equal(new Set(interpreted.map((scene) => scene.prompt)).size, relationshipLines.length);
assert.match(interpreted[0].prompt, /ordinary weekday place/i);
assert.match(interpreted[1].prompt, /laughter comes from just outside the frame/i);
assert.match(interpreted[2].prompt, /two cooling mugs/i);
assert.match(interpreted[3].prompt, /coffee order/i);
assert.match(interpreted[3].prompt, /close over-the-shoulder detail/i);
assert.match(interpreted[4].prompt, /opposite sides of a room/i);
assert.match(interpreted[5].prompt, /awake at the bedside/i);
assert.match(interpreted[6].prompt, /setting down keys and a coat/i);
assert.match(interpreted[7].prompt, /joined hands/i);
assert.match(interpreted[7].prompt, /resolution and emotional choice/i);
assert.deepEqual(
  interpreted.map((scene) => scene.castMode),
  // Object-only stills sit between the figure scenes so the video is not people in every frame,
  // which is what kept pulling an anime checkpoint toward rendered faces.
  ["pair", "object", "solo-a", "object", "pair", "solo-b", "object", "pair"],
);
assert.match(interpreted[1].prompt, /No people anywhere in this frame/i);
assert.match(interpreted[2].prompt, /One young adult woman alone at medium distance/i);
assert.match(interpreted[5].prompt, /One young adult man alone at medium distance/i);
for (const scene of interpreted.filter((item) => item.castMode === "pair")) {
  assert.match(
    scene.prompt,
    /two young adult figures together at medium distance.+solid flat silhouettes/i,
  );
}
for (const [index, line] of relationshipLines.entries()) {
  assert.ok(interpreted[index].prompt.includes(line.replace(/[,.!?;:]+$/, "")));
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-prompt-test-"));
const promptPath = path.join(root, "templates", "prompt.json");
const backupDir = path.join(root, "backups");
const projectPath = path.join(root, "video");
const original = {
  version: 1,
  providers: {
    test: {
      label: "Test",
      format: "natural-language",
      sceneTemplate: "Default {{line}} — {{keywords}} — {{subjectType}}",
      stylePrompt: "default style",
      negativePrompt: "default negative",
    },
  },
};

try {
  await fs.mkdir(path.dirname(promptPath), { recursive: true });
  await fs.mkdir(path.join(projectPath, "content"), { recursive: true });
  await fs.writeFile(promptPath, `${JSON.stringify(original, null, 2)}\n`);
  await fs.writeFile(
    path.join(projectPath, "content", "narration.txt"),
    "I stand beside the window.\nThe rain stops.\n",
  );

  const originalText = await fs.readFile(promptPath, "utf8");
  await saveProjectPromptOverride({
    profileId: "test",
    projectPath,
    values: {
      sceneTemplate: "Video {{line}} — {{keywords}}",
      stylePrompt: "video style",
      negativePrompt: "video negative",
    },
  });
  assert.equal(await fs.readFile(promptPath, "utf8"), originalText);

  const resolved = await resolveProjectPromptProfile({
    profileId: "test",
    projectPath,
    promptPath,
  });
  assert.equal(resolved.effective.stylePrompt, "video style");

  const first = await regenerateProjectScenePrompts({
    profileId: "test",
    projectPath,
    preserveEdited: false,
    promptPath,
  });
  const editedPrompt = "A hand-edited first scene";
  first.scenes[0].prompt = editedPrompt;
  await saveScenePrompts({
    profileId: "test",
    projectPath,
    scenes: first.scenes,
    editedSceneIds: [first.scenes[0].id],
  });
  await saveScenePrompts({
    profileId: "test",
    projectPath,
    scenes: first.scenes.map(({ id, prompt }) => ({ id, prompt })),
    editedSceneIds: [first.scenes[0].id],
  });
  assert.deepEqual(
    (await fs.readFile(imagePromptsPath(projectPath), "utf8").then(JSON.parse)).map(
      (scene) => scene.castMode,
    ),
    first.scenes.map((scene) => scene.castMode),
  );

  await saveProjectPromptOverride({
    profileId: "test",
    projectPath,
    values: {
      sceneTemplate: "Revised {{line}} — {{keywords}}",
      stylePrompt: "revised video style",
      negativePrompt: "revised video negative",
    },
  });
  const second = await regenerateProjectScenePrompts({
    profileId: "test",
    projectPath,
    preserveEdited: true,
    promptPath,
  });
  assert.equal(second.scenes[0].prompt, editedPrompt);
  assert.match(second.scenes[1].prompt, /^Revised /);
  assert.deepEqual(second.editedSceneIds, [second.scenes[0].id]);
  assert.deepEqual(await fs.readFile(imagePromptsPath(projectPath), "utf8").then(JSON.parse), second.scenes);

  await assert.rejects(
    promoteProviderDefault({
      profileId: "test",
      values: resolved.effective,
      confirmation: "yes",
      promptPath,
      backupDir,
    }),
    /MAKE DEFAULT/,
  );
  assert.equal(await fs.readFile(promptPath, "utf8"), originalText);

  const promoted = await promoteProviderDefault({
    profileId: "test",
    values: {
      sceneTemplate: "Future {{line}}",
      stylePrompt: "future style",
      negativePrompt: "future negative",
    },
    confirmation: "MAKE DEFAULT",
    promptPath,
    backupDir,
  });
  assert.equal((await fs.stat(promoted.backupPath)).isFile(), true);
  assert.equal((await JSON.parse(await fs.readFile(promptPath, "utf8"))).providers.test.stylePrompt, "future style");

  await restoreProviderDefault({
    profileId: "test",
    backupName: path.basename(promoted.backupPath),
    confirmation: "RESTORE DEFAULT",
    promptPath,
    backupDir,
  });
  assert.equal((await JSON.parse(await fs.readFile(promptPath, "utf8"))).providers.test.stylePrompt, "default style");

  assert.equal(
    await resetProjectPromptOverride({ profileId: "test", projectPath }),
    true,
  );
  console.log("Story interpretation, prompt layering, preservation, promotion, backup, and restore passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
