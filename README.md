# YouTube Short Pipeline

A reusable local pipeline for making 60-second, 9:16 YouTube Shorts with:

- ComfyUI, FLUX.2 Klein, Animagine, Google GenAI, or Cloudflare for visual assets
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

Every content provider uses the same story-aware scene interpretation and solo/shared cast
rhythm. Across the pipeline, a two-person relationship scene is constrained to exactly one adult
man and one adult woman; solo scenes still alternate between a woman and a man. Each provider
keeps its own medium:
nostalgic 35mm editorial photography, paper-cut screen-printed vector shapes, graphite/sepia ink
with restrained watercolor accents, or vintage oil-and-paper-watercolor illustration. The
illustrated choices use warm hand-painted Japanese animated-film atmosphere without copying a
specific film, expressive adult faces, and script-led scenes of love, sadness, separation, or
solitude.

`Illustrated monologue (living storybook)` uses the same oil-painted look but also selects its
matching automatic composition: localized character breathing and sway, a single moving light
pass, drifting haze and motes, and a restrained camera push. Its prompt stages faces and hands
clearly while adding loose hair, fabric, grass, water, smoke, or dust that can carry subtle motion.

`FLUX.2 painted storybook (local first)` is the recommended story provider. It renders with the
local four-step FLUX.2 Klein model and falls back to Cloudflare only when both Cloudflare values
are configured. Its look combines watercolor blooms, selective oil texture, graphite/dry-ink
contours, paper and film grain, expressive contemporary people, and poetic environments. It
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
npx --yes hyperframes@0.7.78 snapshot --at 5,15,25,35,45,55
npm run dev
```

After the preview is approved:

```sh
cd ../..
npm run render -- --project my-video-name --approved
```

The finished file is saved as
`videos/my-video-name/renders/my-video-name.mp4` and verified for duration, 1080×1920, and audio.
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

> Create a 60-second vertical YouTube Short from this script. Follow AGENTS.md, use the configured
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
- [Reusable Shorts style specification](templates/STYLE.md)

Keep `.env` private. The whole `videos/` tree is ignored by Git — this repository is the pipeline,
not the videos it produces. See [Exact workflow](docs/WORKFLOW.md) for what that means for your
narration and prompt files.
