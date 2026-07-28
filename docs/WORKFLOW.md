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

## 3. Generate images and voice

Start the Voicebox app, then run:

```sh
npm run assets -- --project topic-name
```

This calls the Google GenAI API, then builds a Voicebox story from the narration. Each line becomes
its own generation and its own item on the story timeline. The default target is three seconds of
audible silence from the end of one spoken phrase to the beginning of the next. The story is saved
in Voicebox under the `title` from `video.json`, so you can open the app to re-roll a weak line or
review the story.

Check the line split before spending time on generation:

```sh
npm run story -- --project topic-name --dry-run
```

The voice step writes:

- `public/audio/lines/*.wav`: the complete, accepted Voicebox line files.
- `public/audio/narration.wav`: the normalized local assembly with exact audible pauses.
- `public/audio/narration.timing.json`: clip, speech, pause, image, and transition timings.
- `content/story.json`: the story and generation ids, used by `--resume`.

Every line must pass a final-word transcription and have a safe quiet boundary. An unsafe result is
generated once more, then stops with its line number rather than entering the final mix. Run
`npm run validate:narration -- --project topic-name` to repeat the audio and timing checks.

If generation stops partway, `npm run story -- --project topic-name --resume` continues from the
first line that never made it onto the timeline.

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
`narration.txt`, `image-prompts.json`, `STYLE.md`, and `video.json`. Git will not back those up.
Keep a script you care about somewhere outside this repo, or force-add one project:

```sh
git add -f videos/<slug>/content videos/<slug>/video.json
```

Never commit `.env`.

> Staging beats ignoring. `.gitignore` is only consulted for files Git is not already tracking, so
> a stray `git add -A` before these rules existed would have pinned a generated project into the
> index for good. If `git ls-files videos/` ever returns anything, undo it with
> `git rm -r --cached videos/` — that clears the index and leaves your files on disk.
