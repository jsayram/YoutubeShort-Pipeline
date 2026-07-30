# YouTube pipeline agent guide

This repository turns a script or topic into a long-form, 16:9 YouTube video. It coordinates
several external tools:

- The selected provider creates still visual assets: local ComfyUI, local-first FLUX.2 Klein with
  optional Cloudflare fallback, Krea 2 Turbo through local ComfyUI (no cloud fallback, no
  reference-image support), Google GenAI, Pixazo SDXL, or another registered provider.
- Voicebox creates narration through its local REST API, one clip per script line, assembled into a
  Voicebox story. ElevenLabs is an optional alternative narration provider (`scripts/
  elevenlabs-provider.mjs`) — hosted, paid, and gated behind explicit per-line confirmation in
  Studio; Voicebox stays the default.
- HyperFrames builds, previews, validates, and renders the video.
- The Final Cut bridge (optional): `npm run final-cut -- --project <slug>` shells out to the
  sibling repo `../final-cut-youtube-bridge` and writes an editable FCPXML assembly to
  `videos/<slug>/final-cut/<slug>.fcpxml`. It doesn't replace the HyperFrames render path; Studio
  runs both by default after image approval.

Do not clone, vendor, import from, or edit the Voicebox or HyperFrames repositories. Voicebox is a
running local application. HyperFrames is invoked through its versioned `npx` CLI. The Final Cut
bridge is different from both — it's a first-party sibling project, not a vendored external tool,
so patch it directly when asked; keep its own `README.md` current when its behavior changes.

Animation is authored in GSAP against the HyperFrames contract. The motion rules, ease vocabulary,
and the list of seek-safe properties live in the project's `design.md`.

## When asked to create a new video

1. Run `npm run doctor`.
2. Run `npm run new -- <slug>`.
3. Read the supplied source and write:
   - `videos/<slug>/design.md` — the design spec. Fill in the palette, type, components,
     motion, and caption rules before anything else. It is the single source of truth for the
     build; when it and a prompt disagree, it wins. `templates/STYLE.md` is the house playbook
     behind it — the reasoning and the pattern library — not a per-project file.
   - `videos/<slug>/content/narration.txt`
   - `videos/<slug>/content/image-prompts.json`
   - `videos/<slug>/video.json`
4. The default project targets a 10-minute (600-second) runtime, around 1,300 to 1,600 spoken
   words at the same 125-to-145-words-per-minute pace, but scale that to whatever `duration` is
   actually set to. The default three-second pause adds three seconds between every pair of lines,
   so account for that when checking the script still fits the target runtime. Scene count follows
   narration line count — there is no fixed scene target. Write `narration.txt` with one spoken
   beat per line — the line breaks become the clip boundaries.
5. Run `npm run images -- --project <slug>`.
6. Run `npm run story -- --project <slug> --dry-run` to confirm the line split, then
   `npm run story -- --project <slug>`.
   If `captions.enabled` is true, run `npm run align -- --project <slug>` after the voice step.
7. Fill in the **Storyboard** section of `design.md` — one beat per spoken line, timestamps
   taken from `public/audio/narration.timing.json`, naming the dominant element, the supporting
   element, and the animation blueprint for each scene. Show it to the user and get it approved
   before writing any composition. A storyboard is cheap to change; a built composition is not.
8. Use the HyperFrames skills before authoring `videos/<slug>/index.html`.
9. Build direct-child timed clips, a paused seekable animation timeline, and framework-owned
   audio. Read `public/audio/narration.timing.json` and drive `data-start` and `data-duration`
   from the real spoken timings instead of estimating them.
10. Run HyperFrames `check` and capture midpoint snapshots for every scene.
11. Open the final preview. Render only after the user approves it.
12. After approval, run `npm run render -- --project <slug> --approved`.
13. The render command removes descriptive and authoring metadata, verifies the clean MP4, and
    delivers it to `iCloud Drive/YoutubeShortPipeline/ready`. After publishing, the user moves it
    to the sibling `published` folder.

## Narration review checkpoint

The per-line Voicebox review checkpoint is implemented and on by default (Studio's **Review
narration before images** toggle). Before changing Studio's narration or stage ordering, read
`docs/NARRATION-REVIEW-CHECKPOINT.md`; it contains the approved behavior, persistence model,
compatibility constraints, and acceptance criteria this area must keep satisfying.

## Editing rules

- Change narration in `content/narration.txt`, then regenerate voice. Rewriting a line invalidates
  the story, so rebuild it rather than resuming.
- To re-roll one weak line without rebuilding, do it in the Voicebox app, then re-run
  `npm run story -- --project <slug> --resume` to re-export the mix and refresh the timings.
- Change an image prompt in `content/image-prompts.json`, delete only that generated asset, and run
  the image command again.
- Change visual direction in `design.md`, then update the image prompts, the composition CSS, and
  the `imageGen.styleSuffix` in `video.json` together. Those three drifting apart is how a video
  ends up with stills in one palette and graphics in another.
- Change timing in `video.json` and the corresponding `data-start`, `data-duration`, and GSAP
  positions together.
- Active-word captions are opt-in through `captions.enabled` or Studio's **Highlight spoken
  words** toggle. Leave them absent when the option is off; when it is on, use the shared
  `scripts/caption-overlay.mjs` layer rather than creating a second caption style.
- Preserve a readable final frame. Avoid blank or fade-to-black endings.
- Keep important text inside screen-safe margins and use large type.

## Quality rules

- One clear visual idea per scene.
- One dominant element, one supporting element, and one caption zone.
- Use motion to reveal meaning: staged entrances, camera moves, path draws, state changes, and
  transformations. Do not add unrelated wobble.
- Use one animation blueprint per scene and vary the blueprint across the video.
- Use hard cuts for energy, push transitions for progression, and crossfades only for related ideas.
- Inspect a contact sheet before rendering.

## Three independent axes

A video is defined by three choices that must stay separable. Keep them apart when adding
anything; collapsing them is what previously made every look assume a romantic couple.

| Axis | Answers | Lives in |
|---|---|---|
| Engine | which model renders it | `templates/image-styles.json` + `scripts/generate-images-*.mjs` |
| Look | how it is drawn | `templates/prompt.json` |
| Topic | what it is about | `templates/topics/*.json` |

- A **look profile** describes medium, palette, and rendering only. It must not name a cast,
  a relationship, or a subject. Its negative prompt covers medium and lettering, never cast.
- A **topic pack** owns cast, sentiment vocabulary, story beats, scene-direction rules, and
  cast negatives. `cast.mode: "none"` means no people are assumed; `{{castPlan}}`,
  `{{castBrief}}`, `{{castTags}}`, and `{{topicDirection}}` then resolve to nothing and
  `buildScenePrompt` tidies the gap.
- Adding a topic is a new JSON file in `templates/topics/`, nothing else. Start from
  `neutral.json`.
- Retiring a style is a JSON edit; retiring an engine is one line in `generate-images.mjs`
  plus its backend script. `loadStyles` reports a style whose profile was deleted as `broken`
  rather than throwing, so one retirement cannot take the catalogue down.
- Default ids live in `DEFAULTS` in `scripts/studio.mjs`. Do not inline a style id anywhere else.
- Run `npm test` after touching any of the three; `scripts/topics.test.mjs` asserts that a
  cast-less topic leaves no cast text in any look.

## Integration boundaries

- Never put API keys in notes, prompts, commits, or generated manifests.
- Never create a virtual environment inside a Voicebox checkout.
- Do not patch Voicebox or call its internal Python modules. Use its documented REST or MCP
  interface.
- Do not patch HyperFrames. Pin and invoke the published CLI version from `video.json`.
- The whole `videos/` tree stays out of Git. This repository holds the pipeline; every video
  project it scaffolds is local work product, creative source included. Never `git add -f` a
  video project without being asked.
