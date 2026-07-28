import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, readJson, videoDir, writeJson } from "./lib.mjs";

// Turns a pasted script into the two content files the rest of the pipeline reads:
// content/narration.txt (one spoken beat per line) and content/image-prompts.json (one wordless
// still per beat). Everything downstream already knows how to consume those, so the studio UI
// does not need its own path into the pipeline.

// Words that carry no visual meaning, so the generated id stays readable. Declared up here
// because the top-level code below calls promptFor(): the function hoists, a const does not.
const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those it its is are was were be been being " +
    "of to in on at for with from by as into about over under your you i we they he she them my our " +
    "can will just also not no do does did have has had how what when where which who why").split(" "),
);

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const projectDir = videoDir(flags.project);
const configPath = path.join(projectDir, "video.json");
const config = await readJson(configPath);

const source = flags.script
  ? await fs.readFile(path.resolve(flags.script), "utf8")
  : await readStdin();

// A blank line, or a line break, both mean "new spoken beat". Sentences that arrive as one
// long paragraph get split on sentence boundaries so Voicebox still gets usable clip lengths.
const lines = source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .flatMap((line) => (line.length > 320 ? splitSentences(line) : [line]));

if (!lines.length) throw new Error("The script is empty.");

const WORDS_PER_SECOND = 2.6;
const GAP_SECONDS = (config.voicebox?.gapMs ?? 200) / 1000;
const totalWords = lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0);
const estimated = totalWords / WORDS_PER_SECOND + GAP_SECONDS * (lines.length - 1);
const tail = Number(flags.tail ?? 2.5);

await fs.mkdir(path.join(projectDir, "content"), { recursive: true });
await fs.writeFile(path.join(projectDir, "content", "narration.txt"), `${lines.join("\n")}\n`);

// Prompts are only rewritten when asked, so hand-tuned art direction survives a re-run of the
// script step.
const promptsPath = path.join(projectDir, "content", "image-prompts.json");
const existing = await readJson(promptsPath).catch(() => null);
const keep = flags["keep-prompts"] === true || flags["keep-prompts"] === "true";

if (keep && Array.isArray(existing) && existing.length >= lines.length) {
  console.log(`Kept ${existing.length} existing image prompt(s).`);
} else {
  await writeJson(promptsPath, lines.map((line, index) => promptFor(line, index)));
  console.log(`Wrote ${lines.length} image prompt(s).`);
}

if (flags.title) config.title = String(flags.title);
// The real duration is only known once Voicebox has spoken the lines; compose-slideshow
// rewrites this from the measured timings. This estimate keeps video.json coherent until then.
config.duration = Number((estimated + tail).toFixed(2));
await writeJson(configPath, config);

console.log(`${lines.length} line(s), ~${totalWords} words, estimated ${estimated.toFixed(1)}s spoken.`);
for (const [index, line] of lines.entries()) {
  console.log(`${String(index + 1).padStart(2)}. (${line.split(/\s+/).length}w) ${line}`);
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function promptFor(line, index) {
  const words = line
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
  const slug = words.slice(0, 3).join("-") || `beat-${index + 1}`;

  return {
    id: `${String(index + 1).padStart(2, "0")}-${slug}`,
    // The beat itself is the subject. Framing and surface treatment are stated positively —
    // the image generator routes anything phrased as a prohibition to the negative encoder,
    // where it actually works, so prompts here never say "no text".
    prompt:
      `A cinematic editorial photograph representing this idea: ${line} ` +
      "One dominant subject and one supporting element, strong silhouette, cinematic depth, " +
      "clear separation between foreground, subject, and background. Every surface is blank " +
      "and unmarked. Generous empty space in the lower third, kept clear for captions added " +
      "afterwards.",
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
