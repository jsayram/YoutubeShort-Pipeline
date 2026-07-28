# Edit, animate, and restyle a video

## Change one part

| You want to change | Edit | Then run |
|---|---|---|
| Spoken words | `content/narration.txt` | `npm run voice -- --project topic-name` |
| Voice | `video.json` or `--profile` | the voice command again |
| Pause between verses | `voicebox.gapMs` or Studio's Pause field | regenerate voice and compose |
| Active-word captions | Studio's Highlight spoken words toggle or `captions.enabled` | align words and compose |
| One visual | Studio's Final scene prompts or its entry in `content/image-prompts.json` | delete only that generated image, then run the image command |
| Recurring character or palette | `assets/references/` | remove the chosen reference and rerun, or use `--force-references` to redesign all references |
| Overall look | `content/STYLE.md`, prompts, and composition CSS | image generation, snapshots, and preview |
| Scene timing | `video.json`, clip data attributes, and GSAP positions | check, snapshots, and preview |
| On-screen text | `index.html` | check and preview |
| Duration | narration, scene plan, clip timing, and `video.json` | regenerate voice, then check and preview |

Use `--force` with the image command only when you intentionally want every visual regenerated.
When narration changes, regenerate the voice before aligning captions. The caption command reads
the individual files in `public/audio/lines/` and places their words inside the measured
`speechStart`–`speechEnd` window recorded in `narration.timing.json`.

## Improve the animations

Give each scene one purposeful motion idea:

- Hook: kinetic type landing on two or three spoken beats.
- Explanation: pan between visual stations as the narration advances.
- Process: type, submit, generate, and reveal as distinct states.
- Comparison: split screen or before-and-after wipe.
- Diagram: draw a path, then reveal nodes in order.
- Ending: assemble the final message and hold it long enough to read.

Separate animation into layers. A slow camera move belongs on a wrapper, the subject gets its own
entrance, and supporting labels arrive afterward. This creates depth without constant wobble.

Use quick entrances, readable holds, and one strong transition between scenes. Hard cuts feel
energetic, directional pushes show progression, and short crossfades work for closely related
ideas. Keep the last frame visible rather than fading to black.

## Improve the visuals

- Keep one dominant object, one supporting object, and one caption zone per scene.
- Use one palette, one illustration treatment, and two type roles across the full video.
- Put critical content inside generous mobile-safe margins.
- Generate images without text or logos; place typography in the composition.
- Favor close subjects, strong silhouette, clear contrast, and uncluttered backgrounds.
- Reuse a small set of border radii, shadows, strokes, and spacing values.
- Review six scene snapshots side by side. The Short should feel varied but obviously belong to one
  visual system.

## Prompt scope and safe defaults

Studio shows the scene template, shared style prompt, and negative prompt for the selected content
provider. Prompt settings have three layers:

| Layer | Stored in | Affects |
|---|---|---|
| Provider default | `templates/prompt.json` | new videos that use that provider |
| Video override | `content/prompt-overrides.json` | only the selected video |
| Scene edit | `content/image-prompts.json` plus `content/prompt-state.json` | only that scene in that video |

The FLUX.2 local-first and Animagine dark-storybook choices also own automatic reference prompts.
They generate a stable faceless character and a style anchor once per project. Regenerating scenes
does not regenerate those anchors, so a weak scene can be rerolled without changing the character.
Studio shows the references above the scene gallery once they exist.

Use **Save for this video** while experimenting. A badge shows when a field is video-specific.
**Reset video to provider default** removes only the current video's override.

Use **Make this the provider default** only after an experiment should become the new baseline for
future videos. Studio labels the action as permanent, requires the exact confirmation
`MAKE DEFAULT`, and saves the complete previous prompt document under
`templates/prompt-backups/`. Those backups are intentionally ignored by Git because they are a
local recovery history. **Restore selected backup** also creates a safety backup before it changes
anything.

Promoting or restoring a provider default does not rewrite existing video overrides or final scene
prompts. This is the main protection against a successful change for one video unexpectedly
altering old work.

When **Preserve my scene prompt edits when rerunning** is enabled, the preparation step regenerates
untouched scenes from the effective template and carries protected scene edits forward by scene
position. **Regenerate every scene** is the only Studio action that deliberately clears all scene
edit protection, and it asks for confirmation.

Templates may use `{{line}}` for the full narration beat, `{{keywords}}` for extracted visual
terms, and `{{subjectType}}` for the inferred actor or object. The effective shared and negative
prompts are flattened into `video.json` on the next pipeline run, so the image generator continues
to consume one resolved project configuration.
