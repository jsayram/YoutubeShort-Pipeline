import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];
  const booleanFlags = new Set([
    "approved",
    "dry-run",
    "fit",
    "force",
    "personality",
    "resume",
    "skip-images",
    "skip-voice-qa",
    "skip-voice",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue;
    } else if (booleanFlags.has(rawKey)) {
      flags[rawKey] = true;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[rawKey] = argv[index + 1];
      index += 1;
    } else {
      flags[rawKey] = true;
    }
  }

  return { flags, positionals };
}

export async function loadEnv() {
  const envPath = path.join(repoRoot, ".env");
  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function assertSlug(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Use a lowercase project slug containing only letters, numbers, and hyphens.");
  }
  return slug;
}

export function videoDir(slug) {
  const safeSlug = assertSlug(slug);
  return path.join(repoRoot, "videos", safeSlug);
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function resolveHyperframesVersion(config = {}) {
  const configured = String(config.hyperframesVersion ?? "").trim();
  if (validPackageVersion(configured)) return configured;

  const template = await readJson(path.join(repoRoot, "templates", "video.json"));
  const fallback = String(template.hyperframesVersion ?? "").trim();
  if (!validPackageVersion(fallback)) {
    throw new Error(
      "No valid HyperFrames version is configured in this project or templates/video.json.",
    );
  }
  return fallback;
}

function validPackageVersion(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? "inherit",
      env: { ...process.env, ...options.env },
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function commandOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Diffusion text encoders have no concept of negation. "no readable text" and "do not generate
// labels" put *text* and *labels* into the positive conditioning, which is the opposite of what
// the words mean — it is a well-known way to summon the lettering you were trying to avoid.
// These helpers move every negated phrase out of the positive prompt and onto the negative side,
// where the sampler can actually act on it.
// Stops at a comma as well as a sentence end. Tag-style prompts (which anime checkpoints want)
// are one long comma-separated line with no full stops, so a clause that ran to the next period
// would swallow the entire prompt on the first "no" and push the whole scene into the negative.
const NEGATION_CLAUSE =
  /\b(?:no|without|avoid|avoiding|never|free of|excluding|do not|don't|do no)\b[^.;,]*/gi;

// Booru-trained checkpoints learned "no humans" as an actual tag, so it belongs in the positive
// prompt. It is the rare case where a "no X" phrase means something to the encoder.
const NEGATION_KEEP = /^no (?:humans?|people|person|males?|females?)$/i;

// Leading words to drop once a clause has been pulled out, so "do not generate labels" is filed
// under "labels" rather than under a sentence fragment the encoder cannot use.
const NEGATION_LEAD =
  /^(?:no|without|avoid|avoiding|never|free of|excluding|do not|don't|do no|generate|include|attempt to|use|add|show|contain|render)\s+/i;

export const TEXT_NEGATIVES = [
  "text",
  "letters",
  "lettering",
  "words",
  "writing",
  "handwriting",
  "typography",
  "font",
  "numbers",
  "digits",
  "caption",
  "subtitle",
  "title card",
  "label",
  "signage",
  "sign",
  "poster text",
  "book title",
  "embossed lettering",
  "engraved title",
  "printed page",
  "newspaper",
  "document",
  "watermark",
  "signature",
  "logo",
  "wordmark",
  "emblem",
];

// Remove nouns that directly request lettering. Do not include containers such as a screen,
// phone, book, record sleeve, sign, menu, chart, or interface here: those may be the story prop.
const TEXT_NOUN_REPLACEMENT =
  /\b(?:text|texts|lettering|letters|word|words|writing|written|typograph\w*|font|fonts|caption|captions|subtitle|subtitles|title|titles|label|labels|labell?ed|logo|logos|wordmark|watermark|numeral|numerals|digit|digits|html|headline|headlines)\b/gi;

// Keep a text-bearing object while translating its written content into a simple image.
export function makeWordlessVisualPrompt(text) {
  return String(text ?? "")
    .replace(
      /\b(?:single\s+)?(?:unread\s+)?(?:text\s+)?(?:message|notification)(?!\s+(?:glow|light|pulse)\b)(?:\s+bubble|\s+badge|\s+icon|\s+prompt)?\b/gi,
      "soft notification glow on the phone",
    )
    .replace(
      /\breadable\s+(?:phone\s+)?(?:message|notification|interface|screen content)\b/gi,
      "soft notification glow on the phone",
    )
    .replace(
      /\b(?:message|notification)\s+text\b/gi,
      "soft notification glow on the phone",
    )
    .replace(
      /\b(?:playlist|message|notification)\s+(?:icon|symbol|interface)\b/gi,
      "soft abstract light pulse on the phone",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function scrubTextNouns(text) {
  return String(text ?? "")
    // Preserve the surrounding scene instead of deleting an entire clause that happens to
    // mention a logo or label. Losing that clause can remove the narration's primary prop too
    // (for example, "a milkshake cup with a faded logo"). FLUX gets the concrete object while
    // the lettering request becomes a harmless pictorial mark.
    .replace(TEXT_NOUN_REPLACEMENT, "abstract pictorial mark")
    .replace(
      /(?:abstract pictorial mark)(?:\s+abstract pictorial mark)+/gi,
      "abstract pictorial mark",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Provider-wide negatives are defaults, never authority. Remove a negative term when it directly
// contradicts a concrete prop, lighting condition, or composition required by this scene.
export function deconflictNegativePrompt(positive, negative) {
  const wanted = String(positive ?? "").toLowerCase();
  const conflicts = [
    [/\b(?:phone|smartphone|screen|display)\b/, /\b(?:ui|user interface|interface|app screen|glowing display|screen content|keyboard)\b/i],
    [/\b(?:heart symbol|heart icon|pictorial symbol)\b/, /\b(?:icon|badge|emblem|symbol)\b/i],
    [/\bamber\b/, /\b(?:amber light|orange glow)\b/i],
    [/\b(?:sunset|golden hour)\b/, /\b(?:warm sunset|sunset)\b/i],
    [/\b(?:morning|daylight)\b/, /\bdaylight\b/i],
    [/\b(?:overcast|gray morning|grey morning|gray sky|grey sky)\b/, /\b(?:overcast sky|pale grey backdrop)\b/i],
    [/\bsilhouette\b/, /\b(?:silhouette-only character|faceless|featureless face|black void face|face hidden by default|hidden eyes)\b/i],
    [/\bmoon\b/, /\bmoon\b/i],
  ];
  return String(negative ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .filter(
      (term) =>
        !conflicts.some(
          ([required, forbidden]) => required.test(wanted) && forbidden.test(term),
        ),
    )
    .join(", ");
}

// Quoted strings read as "render these exact glyphs". Drop them outright.
export function stripQuotedText(text) {
  return String(text ?? "").replace(/[“”"]([^“”"]{1,160})[“”"]/g, " ");
}

export function splitNegations(text) {
  const negatives = [];
  const positive = String(text ?? "")
    .replace(NEGATION_CLAUSE, (clause) => {
      if (NEGATION_KEEP.test(clause.trim())) return clause;
      for (const part of clause.split(/,|\band\b|\bor\b/i)) {
        // Trim before stripping (the lead pattern is anchored), and strip repeatedly so a
        // stacked lead like "do not generate labels" reduces all the way to "labels".
        let term = part.trim();
        let previous;
        do {
          previous = term;
          term = term.replace(NEGATION_LEAD, "").trim();
        } while (term !== previous);
        term = term.replace(/[.;:]+$/, "").trim();
        if (term.length > 2) negatives.push(term.toLowerCase());
      }
      return "";
    })
    // Tidy the punctuation the removal leaves behind.
    .replace(/\b(?:with|and|or)\s*(?=[,.;]|$)/gi, "")
    .replace(/\s*,\s*(?=[.,;])/g, "")
    .replace(/\s+([.,;])/g, "$1")
    .replace(/([.,;])\s*\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { positive, negatives };
}

export function dedupeTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const raw of terms) {
    for (const part of String(raw).split(",")) {
      const term = part.trim().toLowerCase();
      if (!term || seen.has(term)) continue;
      seen.add(term);
      out.push(term);
    }
  }
  return out;
}
