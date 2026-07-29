import fs from "node:fs/promises";
import path from "node:path";
import { readJson, repoRoot } from "./lib.mjs";

// A topic pack answers "what is this video about", independently of which model renders it
// (templates/image-styles.json) and how it is drawn (templates/prompt.json). Keeping the three
// apart is what lets the same engine and look serve romance today and crypto or animals later.
// This file deliberately mirrors image-styles.mjs so there is one loading pattern to learn.

export const DEFAULT_TOPIC_ID = "romance";

export function topicsDir(root = repoRoot) {
  return path.join(root, "templates", "topics");
}

const REQUIRED_FIELDS = ["id", "label", "storyBeats", "cast", "fallbackSentiment"];

function validateTopic(topic, source) {
  for (const field of REQUIRED_FIELDS) {
    if (topic?.[field] === undefined) throw new Error(`${source} is missing "${field}".`);
  }
  // A bad regex here would otherwise surface much later as a confusing prompt-build crash.
  for (const rule of [...(topic.sentimentRules ?? []), ...(topic.sceneDirectionRules ?? [])]) {
    for (const pattern of [rule.match, rule.and].filter(Boolean)) {
      try {
        new RegExp(pattern, "i");
      } catch (error) {
        throw new Error(`${source} has an invalid rule pattern ${pattern}: ${error.message}`);
      }
    }
  }
  return topic;
}

export async function loadTopics(root = repoRoot) {
  const directory = topicsDir(root);
  const entries = await fs.readdir(directory).catch(() => []);
  const files = entries.filter((name) => name.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No topic packs found in ${directory}.`);

  const topics = [];
  for (const file of files) {
    const source = path.join(directory, file);
    const topic = validateTopic(await readJson(source), source);
    if (topic.id !== path.basename(file, ".json")) {
      throw new Error(`${source} declares id "${topic.id}" but is named ${file}.`);
    }
    topics.push(topic);
  }
  return topics;
}

export async function resolveTopic(topicId = DEFAULT_TOPIC_ID, root = repoRoot) {
  const wanted = String(topicId || DEFAULT_TOPIC_ID);
  const topics = await loadTopics(root);
  const topic = topics.find((entry) => entry.id === wanted);
  if (!topic) {
    throw new Error(
      `Unknown topic "${wanted}". Available: ${topics.map((entry) => entry.id).join(", ")}.`,
    );
  }
  return topic;
}
