# YouTube Pipeline

A reusable local pipeline for making long-form, 16:9 YouTube videos with:

- ComfyUI, FLUX.2 Klein, Animagine, Google GenAI, Cloudflare, or Pixazo SDXL for visual assets
- Voicebox for a local male voice-over
- HyperFrames for composition, animation, preview, and rendering
- ChatGPT Codex or Claude Code as the directing agent

Voicebox and HyperFrames stay external. This project uses their public interfaces and never edits
their repositories.

## One-time setup

You need macOS, Node.js 22 or newer, FFmpeg, and the Voicebox app.

1. Install Voicebox from its
   [official releases](https://github.com/jamiepine/voicebox/releases/latest), open it, download a
   speech engine, and create or select a voice profile. The pipeline defaults to a profile named
   `MyOwn` on the Qwen3-TTS 1.7B model — name your cloned voice that, or point
   `voicebox.profile` in `video.json` at whatever you called yours.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Create your private environment file:

   ```sh
   cp .env.example .env
   ```

4. Put the Google AI Studio key after `GEMINI_API_KEY=` in `.env`.
   Gemini remains optional. For the recurring-free FLUX fallback, also set
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; local FLUX does not need either value.
   Pixazo's free-preview SDXL Base provider is optional too; set `PIXAZO_API` to enable it.
5. Check the setup:

   ```sh
   npm run doctor
   ```

HyperFrames does not need a clone or global installation. The project runs the pinned package with
`npx`.

## Make another video

```sh
npm run new -- my-video-name
```

Then edit these four files:

- `videos/my-video-name/design.md` — the design spec: palette, type, components, motion,
  captions, and the storyboard. Single source of truth for the build; fill it in first.
- `videos/my-video-name/content/narration.txt`
- `videos/my-video-name/content/image-prompts.json`
- `videos/my-video-name/video.json`

On-screen material goes in `videos/my-video-name/assets/` (`logos/`, `clips/`, `fonts/`), which
is already where `hyperframes.json` points its asset path.

Write `narration.txt` with one spoken beat per line. Voicebox speaks each line separately and lays
them out as a story, which keeps the delivery tight and gives you exact per-line timings to animate
against. The default is three seconds of audible silence between beats. The current image keeps
animating through that pause, and the next image finishes its 0.5-second entrance before its voice
begins. Change the pause in Studio or with `voicebox.gapMs` in `video.json`.

Studio enables **Review narration before images** by default. It keeps every generated take under
the video project, pauses before image generation, and resumes only after every current line has a
passing selected take. Editing a line preserves its earlier takes as history, rebuilds that scene's
base prompt, and immediately generates a take for the revised wording. Turn the toggle off for the
non-interactive first-passing-take workflow.

Studio also pauses at **Image review** before composition. Every scene shows its narration,
editable project-local scene prompt, selected image, retained image takes, and a collapsed
generation audit containing the exact provider prompt, negative prompt, model, seed, and settings.
**Regenerate this image** changes only that scene and never overwrites an earlier take. Every image
must be approved before **Continue to composition** is enabled. Editing or selecting a take clears
approval only for that scene. Cloud takes show the provider-reported credits and remaining quota
when supplied; otherwise Studio shows the exact cloud request count and explicitly says that the
provider did not report its credit cost or remaining balance.

Active-word captions are optional and off by default. Turn on **Highlight spoken words** in
Studio to align the narration, show short phrase groups, and highlight the current word in gold
inside the HyperFrames composition. The captions disappear during silent pauses. The saved setting
lives at `captions.enabled` in `video.json`; command-line projects can prepare the timings with:

```sh
npm run align -- --project my-video-name
```

Alignment runs against each Voicebox line separately, then fits those words into that line's
measured `speechStart`–`speechEnd` window. This preserves the exact three-second gaps instead of
letting a speech engine compress the silence and make later captions progressively early.

For an imported or existing project, **Regenerate existing images** is passed through to every
image backend and replaces scene files instead of reusing them. Character and style reference
images remain stable unless references are explicitly regenerated. Imported Gemini projects also
remove an older PNG/JPG/WebP variant after the replacement succeeds, preventing the preview from
showing the wrong extension.

The Local services controls now separate lightweight reads from destructive recovery:

- **Check status** rereads live health and queue state without stopping anything.
- **Reload images** rereads the selected project's files from disk without rerunning generation.
- **Restart everything…** asks for confirmation, cancels the current pipeline, stops browser
  audio/video, clears ComfyUI's queue, and restarts ComfyUI and Voicebox.

Refreshing or closing the browser does not cancel the pipeline or erase the page state. Studio
replays the saved run, restores narration and image approvals, and rereads finished image files
when the page reconnects. Only the explicit **Restart everything…** control clears the active
Studio session and restarts local services. Voicebox is considered ready only after its old
application process has fully exited and its health and profile APIs pass several consecutive
checks; the environment check also waits through a normal Voicebox startup instead of failing
during model loading.

The Studio's Content provider dropdown loads a matching prompt profile from
`templates/prompt.json`. Open **Edit image prompts** beneath the dropdown to work at three safe
levels:

1. **Provider default** — the starting point for future videos.
2. **This video** — an override saved to `content/prompt-overrides.json`; it cannot affect another
   video.
3. **Final scene prompts** — individual prompts in `content/image-prompts.json`. Scenes you edit
   are marked as protected, so a rerun can rebuild untouched scenes without erasing your work.

**Save for this video** is the normal, safe action. **Make this the provider default** is explicitly
permanent for future videos, requires typing `MAKE DEFAULT`, and backs up the prior
`templates/prompt.json` automatically. Studio can restore those backups. Existing per-video
overrides and saved scene prompts never change when a provider default is promoted or restored.

The **Preserve my scene prompt edits when rerunning** toggle protects only scenes recorded as edits
by Studio. Older projects without edit tracking retain the historical all-prompts behavior until
their scenes are saved or regenerated through the new editor. Scene templates may use `{{line}}`
for the complete narration beat, `{{keywords}}` for its extracted visual terms, and
`{{subjectType}}` for the inferred actor or object. Story-aware profiles can also use
`{{sentiment}}`, `{{storyBeat}}`, `{{visualAction}}`, `{{shotPlan}}`, `{{castPlan}}`, and
`{{continuity}}`. Those values turn a line into an emotional event, a physical action, a solo or
shared cast decision, and a varied camera plan instead of passing a loose bag of words to the
image model.

**Smarter scene prompts** is a separate, removable layer above that system. When enabled, the
image dispatcher asks headless LM Studio (`LMSTUDIO_MODEL`, default `qwen/qwen3.5-4b`) to turn each
script line into a more concrete, neighbor-aware scene before handing it to whichever provider is
selected. It never edits `templates/prompt.json` or the video's saved
`content/image-prompts.json`; the enriched result is written to
`content/image-prompts.enriched.json`. That approved overlay is reused on later image rerolls while
the source prompts are unchanged; pass `--refresh-enriched` to deliberately ask the LLM for new
scene descriptions. The narration and Qwen's concrete scene own the objects, subject count,
location, light, and camera; the topic's draft cast/action plan is advisory, and the look profile
still owns only medium, palette, and texture. Text-bearing story props remain visible but their
content is converted to a simple pictorial symbol (a heart for relationship beats), never readable
lettering. Turn the toggle off and the pipeline immediately uses the original provider prompts. If
LM Studio is stopped, missing its model, or cannot run inference, generation continues with the
original prompts instead of failing. Studio shows LM Studio and the configured model in **Local
services**. The standalone
`npm run enrich -- --project <slug>` command remains available when a permanent, reviewable prompt
rewrite is wanted.

Every image run writes a reproducibility record under `public/generated/audit/`. `latest.json`
points to the newest run, while timestamped records remain as history. Each record includes the
enrichment service and model, service capabilities observed at runtime, source and overlay
prompts, exact final positive and negative prompts, checkpoint/model, dimensions, steps,
guidance/CFG, sampler, scheduler, seed, references, elapsed time, output path, SHA-256 hash, and
complete error details. Credentials are redacted. The exact final prompt is also stored with each
generated entry in `public/generated/manifest.json`.

For a controlled comparison, regenerate only selected numbered scenes without touching the rest:

```sh
npm run images -- --project my-video-name --force --only 01,05,06
```

Partial runs merge their new entries into the existing manifest and skip stale-image cleanup, so
unselected scenes remain intact.

Ordinary rerolls now reuse the approved enriched overlay automatically. To make that choice
explicit while reproducing an older run, pass the saved seed salt:

```sh
npm run images -- --project my-video-name --force --only 01,05,06 \
  --reuse-enriched --seed-salt 1552041690
```

To deliberately replace the approved Qwen scene descriptions:

```sh
npm run images -- --project my-video-name --refresh-enriched
```

Every content provider uses the same story-aware scene interpretation. Without enrichment, topic
packs continue to provide their solo/shared cast rhythm. With enrichment enabled, the concrete
scene decides whether objects, one person, or multiple people best communicate the narration;
topic cast information supplies continuity only when people belong in that scene. Each provider
keeps its own medium:
nostalgic 35mm editorial photography, rough screen-printed vector shapes, dry-brush ink with
restrained color washes, or rough oil-and-gouache illustration. They share a house direction:
mostly medium-long or wide storytelling, visible handmade texture, deep reds and burnt oranges,
muted golds and yellows, restrained moss and olive greens, and low sunrise, sunset, or amber
interior light. Illustrated choices favor broad bristlework and distant emotional staging over a
clean animation or cel-rendered finish.

`Illustrated monologue (living storybook)` uses the same rough painted look but also selects its
matching automatic composition: localized character breathing and sway, a single moving light
pass, drifting haze and motes, and a restrained camera push. Its prompt stages faces and hands
clearly while adding loose hair, fabric, grass, water, smoke, or dust that can carry subtle motion.

`FLUX.2 painted storybook (local first)` is the recommended story provider. It renders with the
local four-step FLUX.2 Klein model and falls back to Cloudflare only when both Cloudflare values
are configured. Its look combines broad bristle strokes, dry-brush drag, palette-knife scumbling,
broken charcoal contours, rough paper or canvas, aged grain, distant figures, and poetic
environments lit like sunrise or sunset. It
automatically creates three stable files under `assets/references/`: two separate neutral
single-character guides and a wordless materials/palette guide. The references deliberately have
no interaction, location, or story composition to copy. Their versioned names prevent the older
paired seaside reference from forcing every scene into the same pose and setting. Scene
regeneration reuses the new references; use `--force-references` only when you intentionally want
a new cast and art direction.

For an eight-scene story, the story-aware cast plan normally uses three shared turning points and
five solo frames that alternate the recurring woman and man. Solo FLUX scenes receive only the
chosen character reference plus the materials reference. The absent person may be suggested by
an off-frame hand, shadow, reflection, empty chair, second cup, keepsake, or negative space.

`Animagine dark faceless storybook` is separate from the existing Animagine-backed providers. Its
simplified prompt begins with the complete narration line, adds one short literal action and one
camera direction, then applies a dark oil-and-watercolor paper treatment. It no longer forces a
hooded full-body character, centered pose, or repeated streetlamp. Faces stay turned away or
softly shadowed while actions, props, settings, and framing carry the story. Its only automatic
reference is a subject-free paper/material palette, weighted lightly so it cannot dictate the
scene. Selecting it does not change the Anime, Illustrated monologue, Living storybook, or Gemini
providers.

Generate the media:

```sh
npm run assets -- --project my-video-name
```

To render only the new FLUX provider:

```sh
npm run images:flux2 -- --project my-video-name
```

Or build just the voice, checking the line split first:

```sh
npm run story -- --project my-video-name --dry-run
```

```sh
npm run story -- --project my-video-name
```

The story lands in the Voicebox app under the title from `video.json`, alongside
`public/audio/narration.wav` and `public/audio/narration.timing.json`. Use those timings for
`data-start` and `data-duration` when you compose. The pipeline exports every accepted Voicebox
line under `public/audio/lines/`, checks its final word and quiet tail, and assembles the master
locally so no clip is trimmed at a story boundary.

Re-run the timing and audio safety gate at any time:

```sh
npm run validate:narration -- --project my-video-name
```

Build the HyperFrames composition in `videos/my-video-name/index.html`, then validate and preview:

```sh
cd "videos/my-video-name"
npx --yes hyperframes@0.7.78 check
npx --yes hyperframes@0.7.78 snapshot --at <timestamps evenly spaced across the video's duration>
npm run dev
```

After the preview is approved:

```sh
cd ../..
npm run render -- --project my-video-name --approved
```

The finished file is saved as
`videos/my-video-name/renders/my-video-name.mp4` and verified for duration, 1920×1080, and audio.
Before delivery, the pipeline removes descriptive, authoring, location, and chapter metadata
without re-encoding the picture or sound. It then copies the clean MP4 to
`iCloud Drive/YoutubeShortPipeline/ready`. After uploading it, move it manually from `ready` to
`published`. Existing names are never overwritten; a second render is delivered with a numbered
filename.

To clean and deliver an already-rendered project:

```sh
npm run deliver -- --project my-video-name
```

## Use with ChatGPT Codex or Claude Code

Open this folder in the coding agent and ask:

> Create a long-form, 16:9 YouTube video from this script. Follow AGENTS.md, use the configured
> Voicebox profile, generate coherent visual assets, show me the final preview, and do not render
> until I approve it.

`AGENTS.md` contains the operational rules. `CLAUDE.md` points Claude Code to the same instructions.
For optional direct Voicebox control in Claude Code, see [Architecture](docs/ARCHITECTURE.md).

## Guides

- [Exact workflow](docs/WORKFLOW.md)
- [Editing, animation, and visual styling](docs/EDITING-AND-STYLE.md)
- [Clean integration architecture](docs/ARCHITECTURE.md)
- [AI topic-to-asset-pack master prompt](templates/AI-ASSET-PACK-PROMPT.md)
- [Animated visual style guide](docs/STYLE-GUIDE.html)
- [Reusable video style specification](templates/STYLE.md)

Keep `.env` private. The whole `videos/` tree is ignored by Git — this repository is the pipeline,
not the videos it produces. See [Exact workflow](docs/WORKFLOW.md) for what that means for your
narration and prompt files.
