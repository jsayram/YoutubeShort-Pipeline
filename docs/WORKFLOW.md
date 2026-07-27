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
its own generation and its own item on the story timeline, spaced by 200 ms. The story is saved in
Voicebox under the `title` from `video.json`, so you can open the app to re-roll a weak line, nudge
an item, or export the mix yourself.

Check the line split before spending time on generation:

```sh
npm run story -- --project topic-name --dry-run
```

Three files come out of the voice step:

- `public/audio/narration.wav`: the normalized mix, padded to the configured duration.
- `public/audio/narration.timing.json`: the start and duration of every spoken line.
- `content/story.json`: the story and generation ids, used by `--resume`.

If generation stops partway, `npm run story -- --project topic-name --resume` continues from the
first line that never made it onto the timeline.

## 4. Compose the video

In `videos/topic-name/index.html`:

- Make every scene a direct child of the composition.
- Give every scene `class="clip"`, `data-start`, and `data-duration`.
- Add the narration as framework-owned audio.
- Use a paused, seekable GSAP timeline for deterministic animation.
- Take `data-start` and `data-duration` from `public/audio/narration.timing.json` so every scene,
  caption, and reveal lands on the line it belongs to.

## 5. Inspect before rendering

```sh
cd "videos/topic-name"
npx --yes hyperframes@0.7.76 check
npx --yes hyperframes@0.7.76 snapshot --at 5,15,25,35,45,55
npm run dev
```

Review the six snapshots as a contact sheet, then watch the complete preview on a phone-sized
viewport. Fix clipping, weak hierarchy, blank frames, timing gaps, and narration sync.

## 6. Render only after approval

```sh
cd ../..
npm run render -- --project topic-name --approved
```

The render command runs a final HyperFrames check and verifies exact duration, 1080×1920 output,
and the presence of audio.

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
