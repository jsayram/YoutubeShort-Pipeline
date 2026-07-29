# Narration review checkpoint

Status: implemented.

This document is the implementation handoff for adding per-line Voicebox review to Pipeline
Studio. It records the decisions already made so the feature can be built without reopening the
product questions.

## Problem

The existing automatic narration checks can verify that a final word is present and preserve or
append quiet samples at the file boundary. They cannot judge cadence, phoneme completion, or
whether the last syllable sounds unnaturally clipped. A line can therefore pass validation and
still need a human re-roll.

Studio currently generates images before narration. The new workflow must generate and approve
narration first so image generation does not begin while the script or timing can still change.

## Approved behavior

- Add a **Review narration before images** toggle, enabled by default.
- Generate one initial Voicebox take for every non-empty narration line.
- Select the first successful take automatically.
- Pause the pipeline at a persistent narration-review checkpoint before generating any images.
- Show every script line with:
  - an editable sentence;
  - playback for its selected take;
  - a **Regenerate** action using the same Voicebox profile, engine, model, and language;
  - every generated take, each independently playable;
  - duration and automatic QA status;
  - a control for choosing the active take.
- Retain every take. Regeneration must never overwrite or delete an earlier take.
- The final checkpoint action is **Approve narration and generate images**.
- When review is disabled, automatically use the first successful take for every line, assemble
  narration, and continue without stopping.
- Voicebox remains an external installed application. Do not edit or vendor its repository.

## Editing rules

- Lines are keyed by stable one-based position (`01`, `02`, and so on), not by words in an image
  filename.
- Keep the originally submitted Studio script as immutable source material in
  `content/source-script.txt`. Narration edits never rewrite it.
- Once `content/narration.txt` exists for a project, it is the persistent working script and
  overrides the original source on every regeneration or pipeline rerun.
- Editing a sentence updates `content/narration.txt` atomically.
- Rebuild that scene's prompt from the revised wording before images exist.
- Preserve takes made for previous wording as history, visibly labelled with that wording.
- A take whose stored text differs from the current line cannot be selected for final assembly.
- After an edit, regenerate the line with the same saved voice settings.
- Caption alignment and scene timing use only the final text and selected take.

## Target pipeline order

1. Environment check
2. Project scaffold or import
3. Script and base scene prompts
4. Generate initial narration takes
5. Narration review checkpoint
6. Assemble and validate selected narration
7. Generate images
8. Align captions when enabled
9. Compose
10. Validate
11. Render when requested

The three-second audible pauses remain an assembly concern. Each isolated player should preview
the exact normalized line clip that will be used in the master, without requiring the listener to
wait through the inter-scene pause.

## Persistence model

Store review state inside the video project so browser refreshes and Studio restarts do not lose
work. The manifest should contain:

- current text and stable line index;
- every take's Voicebox generation id;
- source and normalized local audio paths;
- creation time, duration, QA result, and the exact text spoken;
- selected take id;
- line approval validity;
- overall checkpoint status.

A practical location is `content/narration-review.json`, with immutable audio candidates under
`public/audio/lines/candidates/<line-index>/`. The existing `content/story.json` can remain the
final assembled Voicebox story manifest rather than becoming the UI review database.

Writes must be atomic. Candidate filenames must be unique and never reuse a prior take's path.

## Backend work

Refactor the reusable Voicebox operations currently embedded in `scripts/generate-story.mjs` into
a pipeline-owned module:

- generate and poll one Voicebox take;
- export source audio;
- normalize without cutting spoken samples;
- run final-word and quiet-tail QA;
- persist a candidate;
- assemble selected candidates;
- rebuild Voicebox story items and their measured start times;
- write `narration.wav` and `narration.timing.json`;
- run final narration validation.

Add Studio endpoints for:

- reading review state;
- editing one line;
- generating another take for one line;
- selecting a take;
- approving the complete selection and resuming the pipeline.

Only one regeneration may run for a given line at once. The UI must show progress and return a
clear line-specific error without invalidating other accepted candidates.

## Studio work

Reorder `stageList()` and `startRun()` in `scripts/studio.mjs` so voice precedes images. Add a
distinct review stage or a clear `waiting-for-review` state between them.

The review stage must survive a browser refresh. Reopening an awaiting project should restore all
players, candidates, edits, and selections. Pipeline continuation must validate that:

- every current line has a selected take;
- each selected take speaks the current text;
- every selected take passed required automatic checks.

Only then should approval assemble narration and start image generation.

## Prompt and downstream invalidation

An inline text edit occurs before image generation and must:

1. update the corresponding narration line;
2. rebuild its base scene prompt;
3. invalidate enriched prompt overlays for that scene;
4. mark caption alignment, composition, validation, and render outputs stale;
5. require a selected take matching the new text.

LLM scene enrichment stays optional and provider-independent. It runs later as part of image
generation and must interpret the revised wording.

## Compatibility

- Existing projects without a review manifest must continue to work.
- The CLI can retain a non-interactive path that selects the first passing take.
- `--resume` behavior must not silently select a take recorded for different wording.
- Turning review off must not remove saved candidates or modify provider prompts.
- Image-provider behavior, prompt profiles, Voicebox source, and HyperFrames source remain
  untouched.

## Acceptance criteria

- Images do not start while review is enabled and narration is awaiting approval.
- Every generated take remains playable after further regenerations and browser refresh.
- Selecting an older matching take changes the final assembled narration.
- Editing a sentence updates its prompt and prevents selection of takes for the old sentence.
- Approval is blocked when any current line lacks a valid selected take.
- Approval rebuilds exact three-second speech-to-speech pauses and current timing metadata.
- Captions align to the final selected audio.
- Disabling review completes the pipeline automatically with first passing takes.
- Automated tests cover persistence, editing, candidate retention, selection, approval gating,
  stage order, refresh recovery, and the review-disabled path.
