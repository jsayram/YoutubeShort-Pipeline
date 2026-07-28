import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, readJson, videoDir, writeJson } from "./lib.mjs";

// Builds a plain image slideshow composition straight from the measured narration timings, so a
// pasted script reaches a finished MP4 without an agent in the loop. One still per spoken line,
// a slow camera move on each, cross-fades between them, and the narration wired as framework
// audio. Deliberately caption-free: captions are added afterwards.
//
// This is the automatic floor, not the ceiling. An agent authoring index.html by hand against
// the same timings will always beat it; re-running this overwrites that work, so it refuses to
// clobber a hand-authored file unless --force is passed.

const { flags } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const slug = flags.project;
const projectDir = videoDir(slug);
const configPath = path.join(projectDir, "video.json");
const config = await readJson(configPath);
const timingPath = path.join(projectDir, "public", "audio", "narration.timing.json");
const timing = await readJson(timingPath).catch(() => null);

if (!timing) {
  throw new Error(
    `${timingPath} is missing. Build the voice first: npm run story -- --project ${slug}`,
  );
}

const compositionPath = path.join(projectDir, "index.html");
const existing = await fs.readFile(compositionPath, "utf8").catch(() => "");
const generated = existing.includes(GENERATED_MARKER());

// `hyperframes init` leaves a placeholder with a registered-but-empty timeline and its clips
// only shown inside an HTML comment. That file is meant to be replaced, so the guard has to
// tell it apart from real work: strip comments, and if nothing is actually timed, there is
// nothing to lose.
const withoutComments = existing.replace(/<!--[\s\S]*?-->/g, "");
const clipCount = (withoutComments.match(/class="[^"]*\bclip\b[^"]*"/g) ?? []).length;
const scaffold = clipCount === 0;

if (existing && !generated && !scaffold && !flags.force) {
  throw new Error(
    `index.html holds a hand-authored composition (${clipCount} timed clips) and would be ` +
      "overwritten. Pass --force if you really want to replace it.",
  );
}

// One still per spoken line, cycling if fewer images exist than lines.
const generatedDir = path.join(projectDir, "public", "generated");
const manifest = await readJson(path.join(generatedDir, "manifest.json")).catch(() => null);
const onDisk = new Set(
  (await fs.readdir(generatedDir).catch(() => [])).filter((name) =>
    /\.(png|jpe?g|webp)$/i.test(name),
  ),
);

// The manifest is the preferred order, but it can outlive the files it lists — a partial run,
// a deleted still to force a re-roll. Only reference images that are actually on disk, or the
// composition renders holes.
const listed = Array.isArray(manifest) ? manifest.map((entry) => path.basename(entry.file)) : [];
const files = listed.filter((name) => onDisk.has(name));
for (const name of [...onDisk].sort()) {
  if (!files.includes(name)) files.push(name);
}
const missing = listed.filter((name) => !onDisk.has(name));

if (!files.length) {
  throw new Error(
    `No images in ${path.relative(projectDir, generatedDir)}. ` +
      `Generate them first: npm run images -- --project ${slug}`,
  );
}

const lines = timing.lines ?? [];
if (!lines.length) throw new Error("The timing file has no lines.");

// The narration ends when the last line ends; hold past it so the final frame is readable
// rather than cutting on the last syllable.
const tail = Number(flags.tail ?? 2.5);
const spoken = Number(timing.spokenDuration ?? lines.at(-1).end);
const duration = Number((spoken + tail).toFixed(2));

const FADE = 0.5;
const width = Number(config.width ?? 1080);
const height = Number(config.height ?? 1920);

const scenes = lines.map((line, index) => {
  const start = index === 0 ? 0 : Number(line.start);
  const nextStart = index === lines.length - 1 ? duration : Number(lines[index + 1].start);
  // Every clip except the last runs into its successor by one fade length, so the cross-fade
  // has two live layers to work with.
  const end = index === lines.length - 1 ? duration : nextStart + FADE;
  return {
    index,
    id: `scene-${index + 1}`,
    file: files[index % files.length],
    start: round(start),
    duration: round(end - start),
    // Alternate the push direction so consecutive stills do not drift the same way.
    zoomIn: index % 2 === 0,
    driftX: index % 4 < 2 ? 1 : -1,
    driftY: index % 3 === 0 ? -1 : 1,
  };
});

// Prefer a vendored GSAP when one is present, so the composition renders with no network.
const vendored = await fs
  .access(path.join(projectDir, "public", "vendor", "gsap.min.js"))
  .then(() => true, () => false);
const gsapSrc = vendored
  ? "public/vendor/gsap.min.js"
  : "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

await fs.writeFile(compositionPath, renderHtml());

config.duration = duration;
await writeJson(configPath, config);
timing.videoDuration = duration;
await writeJson(timingPath, timing);

console.log(`Wrote ${path.relative(projectDir, compositionPath)}`);
console.log(
  `${scenes.length} scene(s) over ${duration}s (${spoken.toFixed(2)}s spoken + ${tail}s hold), ` +
    `${files.length} image(s)${vendored ? ", local GSAP" : ""}.`,
);
if (missing.length) {
  console.log(`Note: ${missing.length} manifest entr(ies) have no file on disk: ${missing.join(", ")}`);
}
if (files.length < lines.length) {
  console.log(`Note: ${files.length} image(s) for ${lines.length} line(s) — stills repeat.`);
}

function round(value) {
  return Number(Number(value).toFixed(3));
}

function GENERATED_MARKER() {
  return "generated by scripts/compose-slideshow.mjs";
}

function renderHtml() {
  const sceneMarkup = scenes
    .map(
      (scene) => `      <div
        id="${scene.id}"
        class="clip scene"
        data-start="${scene.start}"
        data-duration="${scene.duration}"
        data-track-index="${scene.index + 1}"
      >
        <div id="${scene.id}-inner" class="scene-inner" data-layout-allow-overflow="true">
          <img class="still" src="public/generated/${scene.file}" alt="" />
        </div>
      </div>`,
    )
    .join("\n");

  const sceneData = scenes
    .map(
      (scene) =>
        `        { id: "${scene.id}", start: ${scene.start}, duration: ${scene.duration}, ` +
        `zoomIn: ${scene.zoomIn}, driftX: ${scene.driftX}, driftY: ${scene.driftY} }`,
    )
    .join(",\n");

  return `<!doctype html>
<html lang="en" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(config.title ?? slug)}</title>
    <!-- ${GENERATED_MARKER()} — re-running the compose step replaces this file. -->
    <script src="${gsapSrc}"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #08080b;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
      }
      /* Full-bleed child rather than a root background, so the producer can drop its own. */
      #bg-fill {
        position: absolute;
        inset: 0;
        background: #08080b;
      }
      .scene {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      /* The camera move rides this wrapper. The framework owns .clip visibility, so the clip
         itself is never tweened. */
      .scene-inner {
        position: absolute;
        inset: 0;
        will-change: transform, opacity;
      }
      .still {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration}"
      data-width="${width}"
      data-height="${height}"
    >
      <div id="bg" class="clip" data-start="0" data-duration="${duration}" data-track-index="0">
        <div id="bg-fill"></div>
      </div>

${sceneMarkup}

      <audio
        id="vo"
        src="public/audio/narration.wav"
        data-start="0"
        data-duration="${round(Math.min(spoken, duration))}"
        data-track-index="${scenes.length + 1}"
        data-volume="1"
      ></audio>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      const FADE = ${FADE};
      // Overscan: the still is always larger than the frame, so a drifting camera can never
      // expose an edge. Drift stays inside the margin the smallest scale leaves.
      const SCALE_NEAR = 1.08;
      const SCALE_FAR = 1.18;
      const DRIFT_X = 18;
      const DRIFT_Y = 26;

      const scenes = [
${sceneData}
      ];

      for (const scene of scenes) {
        const inner = "#" + scene.id + "-inner";
        const from = scene.zoomIn ? SCALE_NEAR : SCALE_FAR;
        const to = scene.zoomIn ? SCALE_FAR : SCALE_NEAR;

        // One continuous move per scene, linear so the camera never appears to stall.
        tl.fromTo(
          inner,
          { scale: from, x: -DRIFT_X * scene.driftX, y: -DRIFT_Y * scene.driftY },
          {
            scale: to,
            x: DRIFT_X * scene.driftX,
            y: DRIFT_Y * scene.driftY,
            duration: scene.duration,
            ease: "none",
            transformOrigin: "50% 50%",
            immediateRender: false,
          },
          scene.start,
        );

        // Cross-fade on the wrapper. The outgoing scene keeps running underneath for one fade
        // length, which is why its clip was extended.
        tl.fromTo(
          inner,
          { opacity: 0 },
          { opacity: 1, duration: FADE, ease: "none", immediateRender: false },
          scene.start,
        );
      }

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}
