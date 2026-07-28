import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  imagePromptsPath,
  promoteProviderDefault,
  regenerateProjectScenePrompts,
  resetProjectPromptOverride,
  resolveProjectPromptProfile,
  restoreProviderDefault,
  saveProjectPromptOverride,
  saveScenePrompts,
} from "./prompt-profiles.mjs";

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
  console.log("Prompt layering, preservation, promotion, backup, and restore passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
