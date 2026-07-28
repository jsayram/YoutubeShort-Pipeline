# YouTube Short pipeline agent guide

This repository turns a script or topic into a vertical YouTube Short. It coordinates three
external tools:

- Google GenAI creates still visual assets.
- Voicebox creates narration through its local REST API, one clip per script line, assembled into a
  Voicebox story.
- HyperFrames builds, previews, validates, and renders the video.

Do not clone, vendor, import from, or edit the Voicebox or HyperFrames repositories. Voicebox is a
running local application. HyperFrames is invoked through its versioned `npx` CLI.

Animation is authored in GSAP against the HyperFrames contract. The motion rules, ease vocabulary,
and the list of seek-safe properties live in the project's `design.md`.

## When asked to create a new short

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
4. Keep a 60-second script near 125 to 145 spoken words. Use six scenes by default. Write
   `narration.txt` with one spoken beat per line — the line breaks become the clip boundaries.
5. Run `npm run images -- --project <slug>`.
6. Run `npm run story -- --project <slug> --dry-run` to confirm the line split, then
   `npm run story -- --project <slug>`.
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
- Preserve a readable final frame. Avoid blank or fade-to-black endings.
- Keep important text inside mobile safe margins and use large type.

## Quality rules

- One clear visual idea per scene.
- One dominant element, one supporting element, and one caption zone.
- Use motion to reveal meaning: staged entrances, camera moves, path draws, state changes, and
  transformations. Do not add unrelated wobble.
- Use one animation blueprint per scene and vary the blueprint across the video.
- Use hard cuts for energy, push transitions for progression, and crossfades only for related ideas.
- Inspect a contact sheet before rendering.

## Integration boundaries

- Never put API keys in notes, prompts, commits, or generated manifests.
- Never create a virtual environment inside a Voicebox checkout.
- Do not patch Voicebox or call its internal Python modules. Use its documented REST or MCP
  interface.
- Do not patch HyperFrames. Pin and invoke the published CLI version from `video.json`.
- The whole `videos/` tree stays out of Git. This repository holds the pipeline; every video
  project it scaffolds is local work product, creative source included. Never `git add -f` a
  video project without being asked.
