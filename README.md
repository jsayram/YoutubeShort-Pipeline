# YouTube Short Pipeline

A reusable local pipeline for making 60-second, 9:16 YouTube Shorts with:

- Google GenAI for visual assets
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
against.

Generate the media:

```sh
npm run assets -- --project my-video-name
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
`data-start` and `data-duration` when you compose.

Build the HyperFrames composition in `videos/my-video-name/index.html`, then validate and preview:

```sh
cd "videos/my-video-name"
npx --yes hyperframes@0.7.76 check
npx --yes hyperframes@0.7.76 snapshot --at 5,15,25,35,45,55
npm run dev
```

After the preview is approved:

```sh
cd ../..
npm run render -- --project my-video-name --approved
```

The finished file is saved as
`videos/my-video-name/renders/my-video-name.mp4` and verified for 60 seconds, 1080×1920, and audio.

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
- [Animated visual style guide](docs/STYLE-GUIDE.html)
- [Reusable Shorts style specification](templates/STYLE.md)

Keep `.env` private. The whole `videos/` tree is ignored by Git — this repository is the pipeline,
not the videos it produces. See [Exact workflow](docs/WORKFLOW.md) for what that means for your
narration and prompt files.
