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
  "badge",
  "ui",
  "interface",
  "app screen",
  "screen content",
  "menu",
  "button label",
  "keyboard",
  "chart",
  "graph",
  "diagram",
  "infographic",
];

// Nouns that summon lettering no matter how the sentence frames them. "Space for captions",
// "surfaces that could carry writing", and "room for typography" all put the noun into the
// positive conditioning, and the encoder acts on the noun, not on the sentence's intent. Any
// clause containing one of these is dropped from the positive prompt entirely.
const TEXT_NOUNS =
  /\b(?:text|texts|lettering|letters|word|words|writing|written|typograph\w*|font|fonts|caption|captions|subtitle|subtitles|title|titles|label|labels|labell?ed|sign|signs|signage|logo|logos|wordmark|watermark|numeral|numerals|digit|digits|html|ui|interface|screen|infographic|chart|charts|graph|graphs|headline|headlines)\b/i;

export function scrubTextNouns(text) {
  return String(text ?? "")
    // Split on commas too, not just sentence ends. A tag-style prompt is one long comma list
    // with no full stops, so sentence-only splitting would drop the entire prompt over a single
    // offending tag. Splitting per clause keeps the removal surgical.
    .split(/(?<=[.;,])\s+/)
    .filter((clause) => clause.trim() && !TEXT_NOUNS.test(clause))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
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
