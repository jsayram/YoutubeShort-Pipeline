import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, parseArgs, readJson, videoDir, writeJson } from "./lib.mjs";
import { imagePromptsPath, promptStatePath } from "./prompt-profiles.mjs";
import { loadPromptProfiles, loadStyles } from "./image-styles.mjs";
import { localLlmConfig, localLlmGenerate, localLlmStatus } from "./local-llm.mjs";

// ---------------------------------------------------------------------------
// Local LLM client (LM Studio by default)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider detection — classify the style for LLM guidance
// ---------------------------------------------------------------------------

// Detect the provider category from the template text to determine what kind
// of scene descriptions the LLM should produce. This keeps the enrichment
// decoupled from the template system — no new variables, no template edits.
export function detectProviderCategory(profile) {
  const template = profile.sceneTemplate ?? "";
  if (/\bno people\b/i.test(template) && !/\{\{castPlan\}\}/i.test(template)) {
    // photographic, simple — scenes with no people
    return "no-people";
  }
  if (/\bsymboli[cz]\b|\bnon-literal\b|\bnon-figurative\b/i.test(template)) {
    // simple with symbolic/abstract direction
    return "symbolic";
  }
  // storybook, anime, ink-line, flux2, gemini, etc. — scenes with people
  return "people";
}

// Detect the format type to control how LLM output is shaped.
export function detectFormat(profile) {
  const format = profile.format ?? "natural-language";
  if (format === "ordered-tags" || format === "style-tags") return "tags";
  return "prose";
}

// ---------------------------------------------------------------------------
// System prompt construction — style-aware
// ---------------------------------------------------------------------------

const CATEGORY_INSTRUCTIONS = {
  "no-people":
    "The scene must contain NO people, faces, hands, or human figures of any kind. " +
    "Represent human emotion through objects, settings, and empty spaces only.",
  people:
    "Choose whether this beat is best shown through objects only, one person, or multiple people. " +
    "Do not add people merely because the wider story has recurring characters. If people help, " +
    "keep them subordinate to the narration's concrete object or event and describe their position.",
  symbolic:
    "Create a symbolic, non-literal composition. Describe abstract shapes, textures, " +
    "material qualities, and color relationships that evoke the line's feeling. " +
    "No realistic scenes or figures.",
};

const FORMAT_INSTRUCTIONS = {
  prose:
    "Keep your description to 2-3 sentences. No preamble, no explanation, no bullet points.",
  tags:
    "Reply as a short comma-separated tag list (8-15 tags). " +
    "Each tag is a concrete visual detail: objects, materials, colors, settings, light. " +
    "No sentences, no preamble. Example: cracked ceramic mug, dark kitchen counter, " +
    "morning fog through frosted glass, cold blue light, dried tea stain.",
};

export function buildSystemPrompt(profile) {
  const category = detectProviderCategory(profile);
  const format = detectFormat(profile);

  return [
    "You are a visual scene director for a short video. Your job is to translate an abstract " +
      "narration line into ONE specific, concrete visual scene that an image-generation model " +
      "can render.",
    "",
    "Rules:",
    `- ${CATEGORY_INSTRUCTIONS[category]}`,
    "- Name EXACT objects (material, color, condition), a SPECIFIC setting (not generic), " +
      "and the quality of light.",
    "- Keep the scene physically coherent from one camera viewpoint. Do not request opposite " +
      "sides of the same object at once, and use one unambiguous supporting surface or location.",
    "- Find a creative visual metaphor that makes the viewer feel the line without reading it.",
    "- Preserve every concrete object explicitly named by the narration. Those objects are more " +
      "important than a generic cast or composition from the wider story.",
    "- Each scene MUST differ from its neighbors: different primary object, different location, " +
      "different time of day.",
    `- ${FORMAT_INSTRUCTIONS[format]}`,
    "- The image must be wordless. Never request readable text, captions, titles, labels, or " +
      "lettering. When the meaning involves a message, playlist, book, sign, or interface, keep " +
      "the physical object and replace its written content with a soft notification glow, a " +
      "small pulse of light, or a simple abstract pictorial mark. A heart is optional, never required.",
    "",
    "Style context (for your awareness, do not repeat this in your output):",
    profile.stylePrompt ?? "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Per-scene user prompt
// ---------------------------------------------------------------------------

export function sceneConstraints(item) {
  const prompt = String(item.prompt ?? "");
  let requiredEvent =
    prompt.match(/required visual event\s+([\s\S]*?),\s*shot design\s+/i)?.[1]?.trim() ?? "";
  const shotPlan =
    prompt.match(/shot design\s+([\s\S]*?),\s*visual anchors\s+/i)?.[1]?.trim() ?? "";
  const emotionalTone =
    prompt.match(/emotional interpretation\s+([^,]+)/i)?.[1]?.trim() ?? "";
  const castRules = {
    object:
      "No people, faces, hands, silhouettes, or human figures. Express the beat only through the environment and objects.",
    pair:
      "Exactly two recurring older adults. Keep both visually subordinate to the environment and preserve their established relationship staging.",
    "solo-a":
      "Exactly one recurring older adult woman. The absent partner may be implied only through an object, empty place, or shadow.",
    "solo-b":
      "Exactly one recurring older adult man. The absent partner may be implied only through an object, empty place, or shadow.",
  };
  if (
    item.castMode === "object" &&
    /\b(?:person|people|figure|adult|woman|man|hands?|face|handles?|walks?|stands?)\b/i.test(
      requiredEvent,
    )
  ) {
    requiredEvent =
      "Arrange the narration's objects and setting as a quiet still life with no human presence";
  }
  return {
    castMode: String(item.castMode ?? ""),
    castRule:
      castRules[item.castMode] ??
      "Preserve the exact people/no-people requirement and cast described by the existing scene plan.",
    requiredEvent,
    shotPlan,
    emotionalTone,
  };
}

function buildUserPrompt(item, index, total, narrationLines, enrichedNeighbors, format) {
  const line = narrationLines[index] ?? item.prompt;
  const constraints = sceneConstraints(item);
  const parts = [
    `Narration line ${index + 1} of ${total}: "${line}"`,
    "",
    "OPTIONAL CONTINUITY CONTEXT FROM THE DRAFT SCENE:",
    `- Draft cast suggestion: ${constraints.castRule}`,
    constraints.requiredEvent
      ? `- Draft visible action: ${constraints.requiredEvent}`
      : "- Draft visible action: none.",
    constraints.shotPlan
      ? `- Draft camera and composition: ${constraints.shotPlan}`
      : "- Draft camera and composition: none.",
  ];

  // Extract story beat and sentiment from the existing template-built prompt.
  // These markers exist in both natural-language and tag formats.
  const storyMatch = item.prompt.match(/[Ss]tory position[:\s]+([^.,]+)/i);
  const sentimentMatch = item.prompt.match(
    /[Ee]motional interpretation[:\s]+([^.,]+)/i,
  ) ?? item.prompt.match(/[Ss]entiment[:\s]+([^.,]+)/i);
  if (storyMatch) parts.push(`Story position: ${storyMatch[1].trim()}`);
  if (sentimentMatch) parts.push(`Emotional tone: ${sentimentMatch[1].trim()}`);

  // Neighbor context to avoid repetition.
  if (index > 0 && enrichedNeighbors[index - 1]) {
    parts.push(`Previous scene: ${enrichedNeighbors[index - 1]}`);
  }
  if (index < total - 1 && narrationLines[index + 1]) {
    parts.push(`Next narration line: "${narrationLines[index + 1]}"`);
  }

  parts.push(
    "",
    "Create ONE specific, concrete scene for the narration. " +
      "Name exact objects (material, color, condition), the specific room or place, " +
      "and the quality of light. The narration and your concrete visual interpretation are " +
      "authoritative. Preserve every physical object named in the narration. Use the draft " +
      "context only when it strengthens that interpretation; you may replace its cast, action, " +
      "location, or camera. Prefer a dominant still life over generic people when an object can " +
      "carry the meaning. Keep the camera geometry physically coherent: show only properties " +
      "visible from that viewpoint and choose one supporting surface. Keep all visible surfaces " +
      "wordless; use a soft notification glow, small light pulse, or abstract pictorial mark " +
      "instead of a readable message or interface.",
    "",
  );

  if (format === "tags") {
    parts.push("Reply with only comma-separated tags, nothing else.");
  } else {
    parts.push("Reply with only the scene description, nothing else.");
  }

  return parts.join("\n");
}

function cleanSceneDescription(value) {
  return String(value ?? "")
    .replace(/^```(?:json|text)?\s*|\s*```$/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
}

export function buildAuthoritativePrompt({
  item,
  narration,
  scene,
  format,
}) {
  const constraints = sceneConstraints(item);
  const cleanScene = cleanSceneDescription(scene);
  if (!cleanScene) return item.prompt;

  if (format === "tags") {
    return [
      "safe",
      constraints.emotionalTone
        ? `emotional tone ${constraints.emotionalTone}`
        : null,
      `authoritative concrete scene ${cleanScene}`,
      "wordless surfaces",
    ]
      .filter(Boolean)
      .join(", ");
  }

  return [
    `Create one wordless scene for this narration beat: ${narration}`,
    constraints.emotionalTone
      ? `Emotional tone: ${constraints.emotionalTone}`
      : null,
    `Authoritative concrete scene execution: ${cleanScene}`,
    "Keep every visible surface free of readable lettering; use a simple pictorial symbol when needed",
  ]
    .filter(Boolean)
    .join(". ");
}

// ---------------------------------------------------------------------------
// Prompt reconstruction — provider-aware splice strategies
// ---------------------------------------------------------------------------

// Natural-language formats: find the keywords/anchors marker and the continuity
// marker, then replace the section between them with the LLM scene.
const ANCHOR_PATTERNS = [
  /Visual anchors:\s*[^.]*\.\s*/i,        // photographic
  /Literal anchors:\s*[^.]*\.\s*/i,        // flux2-storybook
  /and\s+\S[^.]*\bas visual anchors\.\s*/i, // gemini ("and {{keywords}} as visual anchors.")
  /Key elements from the line:\s*[^.]*\.\s*/i, // simple
];
const CONTINUITY_PATTERN = /(Scene \d+ of \d+[^.]*\.)/i;

function reconstructNaturalLanguage(originalPrompt, llmScene) {
  // Try each anchor pattern to find the splice point.
  for (const pattern of ANCHOR_PATTERNS) {
    const anchorSplit = originalPrompt.split(pattern);
    const continuitySplit = originalPrompt.split(CONTINUITY_PATTERN);

    if (anchorSplit.length >= 2 && continuitySplit.length >= 2) {
      const prefix = anchorSplit[0].trim();
      const continuityIndex = continuitySplit.findIndex((part) =>
        CONTINUITY_PATTERN.test(part),
      );
      const suffix = continuitySplit.slice(continuityIndex).join("").trim();

      return `${prefix} ${llmScene} ${suffix}`
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  // Fallback: prepend the LLM scene to the original prompt.
  return `${llmScene} ${originalPrompt}`
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Tag-based formats (ordered-tags, style-tags): find the "visual anchors" tag
// segment and append the LLM tags after it.
function reconstructTags(originalPrompt, llmTags) {
  // Clean the LLM output: ensure it's a clean comma-separated list.
  const cleanTags = llmTags
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\n/g, ", ");

  // Look for the visual anchors tag segment. In tag format, it appears as:
  // "visual anchors <words>," or "{{keywordsAll}}," — already resolved to actual words.
  const anchorMatch = originalPrompt.match(
    /visual anchors\s+[^,]+,/i,
  );
  if (anchorMatch) {
    // Insert the LLM tags right after the visual anchors segment.
    const insertPoint = anchorMatch.index + anchorMatch[0].length;
    return (
      originalPrompt.slice(0, insertPoint) +
      ` ${cleanTags},` +
      originalPrompt.slice(insertPoint)
    )
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Some tag providers don't use "visual anchors" (e.g., animagine, flat-line-poetry).
  // Look for the shot plan or visual action segments instead.
  const shotMatch = originalPrompt.match(
    /shot design\s+[^,]+,|(?:Medium-long|Medium|Wide|Low-angle|Slightly high)[^,]+,/i,
  );
  if (shotMatch) {
    const insertPoint = shotMatch.index + shotMatch[0].length;
    return (
      originalPrompt.slice(0, insertPoint) +
      ` ${cleanTags},` +
      originalPrompt.slice(insertPoint)
    )
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Last fallback: prepend the LLM tags before the style suffix tags.
  const safeMatch = originalPrompt.match(/,\s*masterpiece\b/i);
  if (safeMatch) {
    return (
      originalPrompt.slice(0, safeMatch.index) +
      `, ${cleanTags}` +
      originalPrompt.slice(safeMatch.index)
    )
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Absolute fallback: append to end.
  return `${originalPrompt}, ${cleanTags}`
    .replace(/,\s*,/g, ",")
    .trim();
}

export function reconstructPrompt(originalPrompt, llmScene, format) {
  if (format === "tags") {
    return reconstructTags(originalPrompt, llmScene);
  }
  return reconstructNaturalLanguage(originalPrompt, llmScene);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  await loadEnv();
  const { flags } = parseArgs(argv);
  if (!flags.project) {
    throw new Error(
      "Usage: npm run enrich -- --project <slug> [--scene 03] [--model llama3.2] [--force]",
    );
  }

  const projectPath = videoDir(flags.project);
  const promptsFile = imagePromptsPath(projectPath);
  const outputFile = flags.output
    ? path.resolve(projectPath, String(flags.output))
    : promptsFile;
  const llm = localLlmConfig({
    provider: flags["llm-provider"],
    model: flags.model,
  });
  const model = llm.model;
  const targetScene = flags.scene ?? null;
  const force = Boolean(flags.force);

  const llmStatus = await localLlmStatus({ provider: llm.provider, model });
  if (!llmStatus.reachable) {
    throw new Error(`${llm.name} is not reachable at ${llm.baseUrl}.`);
  }
  if (!llmStatus.modelReady) {
    throw new Error(
      `${llm.name} is running, but model "${model}" is unavailable. ` +
        `Available: ${llmStatus.models.join(", ") || "none"}.`,
    );
  }
  console.log(`✓ ${llm.name} reachable at ${llm.baseUrl} (model: ${model})`);

  const prompts = await readJson(promptsFile);
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error("No scene prompts found. Run the template step first.");
  }

  const narrationPath = path.join(projectPath, "content", "narration.txt");
  const narrationText = await fs.readFile(narrationPath, "utf8").catch(() => "");
  const narrationLines = narrationText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const config = await readJson(path.join(projectPath, "video.json")).catch(() => ({}));
  const selectedStyle = config.imageGen?.style ?? config.imageGen?.provider ?? "photographic";
  const [profiles, styles] = await Promise.all([loadPromptProfiles(), loadStyles()]);
  const profileId =
    styles.find((style) => style.id === selectedStyle)?.promptProfile ?? selectedStyle;
  const profile = profiles[profileId] ?? profiles[Object.keys(profiles)[0]];
  if (!profile) throw new Error("Could not load a prompt profile.");

  const format = detectFormat(profile);
  const category = detectProviderCategory(profile);
  console.log(`  Provider: ${selectedStyle} · prompt profile: ${profileId} (${category}, ${format})`);

  const statePath = promptStatePath(projectPath);
  const state = await readJson(statePath).catch(() => ({}));
  const editedIds = new Set(state.editedSceneIds ?? []);

  // The standalone command preserves its original behavior. The image dispatcher passes
  // --output to create a temporary overlay instead, so turning the UI toggle off restores the
  // exact provider-built prompts without any cleanup step.
  const backupPath = path.join(projectPath, "content", "image-prompts.draft.json");
  if (outputFile === promptsFile) {
    await writeJson(backupPath, prompts);
    console.log("  Backed up original prompts to image-prompts.draft.json");
  }

  const systemPrompt = buildSystemPrompt(profile);
  console.log(`\nEnriching ${prompts.length} scene prompts…\n`);
  const enrichedDescriptions = new Array(prompts.length).fill(null);
  const enrichedPrompts = [...prompts];

  for (let i = 0; i < prompts.length; i += 1) {
    const item = prompts[i];
    const sceneId = item.id;
    if (targetScene && !sceneId.startsWith(targetScene)) {
      enrichedDescriptions[i] = "(unchanged)";
      continue;
    }
    if (!force && editedIds.has(sceneId)) {
      console.log(`  ${sceneId}: skipped (user-edited)`);
      enrichedDescriptions[i] = "(user-edited, preserved)";
      continue;
    }

    const userPrompt = buildUserPrompt(
      item, i, prompts.length, narrationLines, enrichedDescriptions, format,
    );
    try {
      const scene = await localLlmGenerate({
        provider: llm.provider,
        model,
        system: systemPrompt,
        prompt: userPrompt,
      });
      enrichedDescriptions[i] = scene;
      const constraints = sceneConstraints(item);
      enrichedPrompts[i] = {
        ...item,
        prompt: buildAuthoritativePrompt({
          item,
          narration: narrationLines[i] ?? "",
          scene,
          format,
        }),
        enrichment: {
          status: "completed",
          provider: llm.provider,
          service: llm.name,
          model,
          format,
          generatedAt: new Date().toISOString(),
          description: scene,
          constraints,
          sourcePrompt: item.prompt,
        },
      };
      console.log(`  ${sceneId}: "${narrationLines[i] ?? "(unknown)"}"`);
      console.log(`    → ${scene}\n`);
    } catch (error) {
      // Infrastructure failures affect every remaining scene. Stop immediately so the image
      // dispatcher can fall back to untouched provider prompts instead of spending one failed
      // request per line and pretending an unchanged overlay was enriched.
      if (
        /llama-server|model .* not found|connection refused|fetch failed|ECONNREFUSED/i.test(
          String(error.message ?? error),
        )
      ) {
        throw error;
      }
      console.error(`  ${sceneId}: LLM error — ${error.message}`);
      console.error("    Keeping original prompt.");
      enrichedDescriptions[i] = "(error, kept original)";
      enrichedPrompts[i] = {
        ...item,
        enrichment: {
          status: "failed",
          provider: llm.provider,
          service: llm.name,
          model,
          format,
          attemptedAt: new Date().toISOString(),
          sourcePrompt: item.prompt,
          error: {
            name: error.name ?? "Error",
            message: String(error.message ?? error),
          },
        },
      };
    }
  }

  await writeJson(outputFile, enrichedPrompts);
  console.log(`\n✓ Enriched prompts written to ${path.relative(projectPath, outputFile)}`);
  if (outputFile === promptsFile) {
    console.log(`  Original backed up at ${path.relative(projectPath, backupPath)}`);
    console.log(`  Review the prompts, then run: npm run images -- --project ${flags.project}`);
  } else {
    console.log("  Provider-built prompts remain unchanged; this file is an optional overlay.");
  }
  return { outputFile, prompts: enrichedPrompts };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`✗ ${error.message ?? error}`);
    process.exitCode = 1;
  });
}
