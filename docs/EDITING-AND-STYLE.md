# Edit, animate, and restyle a video

## Change one part

| You want to change | Edit | Then run |
|---|---|---|
| Spoken words | `content/narration.txt` | `npm run voice -- --project topic-name` |
| Voice | `video.json` or `--profile` | the voice command again |
| Pause between verses | `voicebox.gapMs` or Studio's Pause field | regenerate voice and compose |
| One visual | its entry in `content/image-prompts.json` | delete only that generated image, then run the image command |
| Overall look | `content/STYLE.md`, prompts, and composition CSS | image generation, snapshots, and preview |
| Scene timing | `video.json`, clip data attributes, and GSAP positions | check, snapshots, and preview |
| On-screen text | `index.html` | check and preview |
| Duration | narration, scene plan, clip timing, and `video.json` | regenerate voice, then check and preview |

Use `--force` with the image command only when you intentionally want every visual regenerated.

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

Provider prompt profiles live together in `templates/prompt.json`. The selected Studio dropdown
option imports its scene template, shared style prompt, and negative prompt into the project. Refine
provider behavior there; use `{{line}}` for the full narration beat, `{{keywords}}` for the
extracted visual terms, and `{{subjectType}}` for the inferred actor or object. The resulting
per-scene prompts are written to `image-prompts.json`, while the selected shared and negative
prompts are flattened into `video.json` for the generator.
