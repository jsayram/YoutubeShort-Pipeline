# Recreate the workflow

## 1. Start a video

From the project root:

```sh
npm run doctor
npm run new -- topic-name
```

The second command creates a clean HyperFrames project under `videos/topic-name`.

## 2. Write the four inputs

Edit:

1. `content/narration.txt`: roughly 125 to 145 words for a natural 60-second delivery. Put one
   spoken beat on each line. Voicebox reads every line as its own clip, so the line breaks decide
   the phrasing and the scene timing.
2. `content/image-prompts.json`: one prompt per scene, usually six.
3. `content/STYLE.md`: the color, type, image, layout, and motion direction.
4. `video.json`: duration, output size, frame rate, voice profile, and image model.

Keep generated images free of readable text. Add titles and labels in HTML so they stay sharp,
editable, and correctly spelled.

## 3. Generate and review voice, then images

Start the Voicebox app, then run:

```sh
npm run assets -- --project topic-name
```

The CLI keeps its automatic path. In Studio, narration runs first and **Review narration before
images** is enabled by default. Each line receives an initial take and the pipeline pauses until
every current line has a passing selected take. Regenerations are retained as playable history.
Approval assembles the selected takes, creates the Voicebox story, and only then starts images.
The default target is three seconds of audible silence from the end of one spoken phrase to the
beginning of the next.

In Studio, **Regenerate existing images** works the same for newly created and imported projects:
it forwards a forced scene render to the selected backend while preserving stable character/style
references. Local (ComfyUI), FLUX.2, and Cloudflare backends normally derive each scene's seed
from a hash of its id, so a forced re-render with an unchanged prompt used to reproduce the exact
same image. Checking the box now also rolls a fresh random seed salt for the run, so a forced
regeneration renders a genuinely new batch even when nothing else changed. Pass `--seed-salt <n>`
on the CLI to pin that salt and reproduce a specific forced batch. **Check status** and **Reload
images** are read-only refreshes. Use the separately
confirmed **Restart everything…** action only when local state feels stale; it cancels the active
pipeline, clears ComfyUI work, stops browser playback, and restarts ComfyUI and Voicebox. A browser
reload during generation warns first and performs that reset only after the user chooses to leave.
Studio does not enable a new pipeline until the restart is complete, and Voicebox must keep both
its health and profile endpoints ready across repeated checks before the restart is accepted.

Check the line split before spending time on generation:

```sh
npm run story -- --project topic-name --dry-run
```

The voice step writes:

- `public/audio/lines/*.wav`: the complete, accepted Voicebox line files.
- `public/audio/narration.wav`: the normalized local assembly with exact audible pauses.
- `public/audio/narration.timing.json`: clip, speech, pause, image, and transition timings.
- `content/story.json`: the story and generation ids, used by `--resume`.

The FLUX.2 and Animagine dark-storybook providers generate cast/character and style references
before their first scene. They live in `assets/references/` and are shown separately in Studio.
FLUX.2 uses two separate loose-painted contemporary character sheets plus a materials-only study
of rough bristlework, deep reds, burnt oranges, muted golds, restrained greens, and sunrise or
sunset light. Because those references contain no shared pose or location, the scene prompt
remains responsible for the action and composition. Most scenes select only the woman or man
reference plus the materials reference; only shared turning points use both characters.
Animagine retains its faceless dark-storybook character. A normal scene reroll
preserves the anchors, keeping the cast and palette stable. Animagine uses one subject-free
paper/material anchor at low weight and puts the exact narration line first in a concise scene
prompt. Pass `--force-references` only when you want to redesign the applicable references.

Reference generation is reported separately from scene progress. An eight-line script therefore
shows **Images 1/8 … 8/8** even when a provider also creates reference assets.

Flat Vector, Ink Line Art, Anime, Illustrated Monologue, Living Storybook, and FLUX.2 all
translate each narration line into sentiment, story position, a concrete action, a shot plan, and
a cast plan. Their visual media differ, but the default eight-scene rhythm is five alternating
solo woman/man scenes and three shared turning points. Photographic sits outside that rhythm: it
takes no cast or action direction and renders every line as an unpeopled retro film still.

## Topic is separate from style

Style decides how a video looks; **topic** decides what its scenes are about. They are chosen
independently, so the same engine and look can serve romance today and crypto, coding, or animals
later. Topics live in `templates/topics/*.json` and are picked with the Topic dropdown in Studio
or `--topic <id>` on `npm run script`. The choice is saved to `video.json` so a later CLI run
builds the same prompts.

Two ship today. `romance` carries the recurring woman/man cast, the relationship arc, and the
scene rules for suitcases, coffee orders, and rain; it is the default, so existing projects are
unaffected. `neutral` imposes no cast and no emotional arc, reading each line literally, and is
the starting point for a new topic: copy it, and add sentiment and scene-direction rules.

Cast rules used to be hardcoded across every style, which meant a script about Bitcoin still got
"one adult woman and one adult man" in every scene. That vocabulary now lives only in the topic
pack.

**Simple (script-driven)** is the one style that skips all of that scaffolding. Its scene template
passes through the narration line and most of its significant words, with no fixed shot plan, cast
rule, or palette, so composition and art direction come from the model's own reading of the script.
It works with whatever SDXL checkpoint is already installed. Use it when a project's narration is
distinctive enough that you would rather the model interpret it freely than force it through the
story-aware scaffolding above.

**Flat line-art poetry (webtoon, mood sky)** runs on Illustrious XL through ComfyUI rather than
FLUX.2. That is deliberate: FLUX zeroes its negative conditioning and runs at guidance 1, so a
style's negative prompt never reaches the model there. This look depends on suppressing panel
borders, speech bubbles, and lettering, which needs SDXL's real classifier-free guidance.

Every line must pass a final-word transcription and have a safe quiet boundary. An unsafe result is
generated once more. If the retry contains the verified final word but merely ends without enough
quiet samples, the pipeline preserves every spoken sample and appends a short safe tail before
mixing. A missing or unverified final word still stops with its line number. Run
`npm run validate:narration -- --project topic-name` to repeat the audio and timing checks.

If generation stops partway, `npm run story -- --project topic-name --resume` continues from the
first line that never made it onto the timeline.

Optional active-word captions are disabled by default. Turn on **Highlight spoken words** in
Studio, or set `captions.enabled` to `true` in `video.json`. The pipeline then runs the word
alignment step automatically. For a command-line project:

```sh
npm run align -- --project topic-name
```

The automatic composers use those timings to render short phrase groups in HyperFrames, highlight
the currently spoken word, and hide the caption card during silent pauses. The aligner transcribes
each saved Voicebox line independently and restores it to the line's measured global speech
window. Do not replace this with one full-track transcription: speech engines can compress the
three-second gaps and shift every later caption early.

## 4. Compose the video

In `videos/topic-name/index.html`:

- Make every scene a direct child of the composition.
- Give every scene `class="clip"`, `data-start`, and `data-duration`.
- Add the narration as framework-owned audio.
- Use a paused, seekable GSAP timeline for deterministic animation.
- Take `imageStart` and `imageEnd` from `public/audio/narration.timing.json`. The outgoing image
  remains animated throughout the silent pause; the incoming image transitions during the last
  0.5 seconds and is fully visible at `speechStart`.

## 5. Inspect before rendering

```sh
cd "videos/topic-name"
npx --yes hyperframes@0.7.78 check
npx --yes hyperframes@0.7.78 snapshot --at 5,15,25,35,45,55
npm run dev
```

Review the six snapshots as a contact sheet, then watch the complete preview on a phone-sized
viewport. Fix clipping, weak hierarchy, blank frames, timing gaps, and narration sync.

## 6. Render only after approval

```sh
cd ../..
npm run render -- --project topic-name --approved
```

The render command runs a final HyperFrames check, removes descriptive and authoring metadata
without re-encoding, verifies exact duration, 1080×1920 output, and audio, then copies the clean
MP4 to `iCloud Drive/YoutubeShortPipeline/ready`. The local clean copy remains under the project's
`renders/` folder so Studio can play it. After the Short is uploaded, move its iCloud copy from
`ready` to `published`.

To run only the cleanup and delivery step for an existing render:

```sh
npm run deliver -- --project topic-name
```

## What belongs in Git

This repository is the pipeline, not its output. Commit the scripts, templates, instructions, and
docs — the 24 files that make `npm run new` work on a fresh machine.

Everything under `videos/` stays out, including the per-video creative source you write by hand:
`narration.txt`, `image-prompts.json`, `prompt-overrides.json`, `prompt-state.json`, `STYLE.md`, and
`video.json`. Git will not back those up. Keep a script you care about somewhere outside this repo,
or force-add one project:

```sh
git add -f videos/<slug>/content videos/<slug>/video.json
```

Never commit `.env`.

> Staging beats ignoring. `.gitignore` is only consulted for files Git is not already tracking, so
> a stray `git add -A` before these rules existed would have pinned a generated project into the
> index for good. If `git ls-files videos/` ever returns anything, undo it with
> `git rm -r --cached videos/` — that clears the index and leaves your files on disk.
