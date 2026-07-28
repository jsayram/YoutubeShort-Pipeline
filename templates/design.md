# Design Spec — [PROJECT TITLE]

The single source of truth for how this Short looks and moves. Every still, card, caption, and
beat follows this file. Where this file and a prompt disagree, this file wins. The house
playbook in `templates/STYLE.md` explains the reasoning and the pattern library; the values
here are what actually gets built.

**Output:** 1080×1920, 30 fps, duration set by the narration (see `video.json`). Vertical,
motion-graphics led. Nobody is on screen — all motion lives in the graphics.

The **Storyboard** at the bottom is the shot-by-shot plan, matched to the spoken timestamps in
`public/audio/narration.timing.json`. Fill it in and review it before anything renders.

---

## Colors

**Accent (focal):** Acid lime — `#D8FF63`

**Surfaces and text:**

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#0B0D10` | Main background |
| `--surface` | `#15181D` | Cards, panels, device frames |
| `--surface-raised` | `#20242B` | Elevated or selected content |
| `--paper` | `#F5F3EE` | Primary text, light panels |
| `--muted` | `#A7ADB7` | Supporting text |
| `--line` | `#343A44` | Dividers, borders, chart guides |
| `--accent` | `#D8FF63` | Focal color and positive emphasis |
| `--warning` | `#FF6B57` | Failure, friction, the "before" state |
| `--data` | `#75A7FF` | Second data series only |

**Usage:**

- Accent lands once or twice per frame, never everywhere. It marks the one thing to look at.
- `--warning` only when the story contains a real failure or before-state. `--data` only when
  two series must be told apart.
- Neutral surfaces tint toward cool charcoal. No dead grey.
- No purple-to-blue gradients, no rainbow palettes, no full-screen linear gradients. A localized
  radial glow behind the focal element at 15–25% opacity is allowed.
- Generated stills live in this same world — charcoal environment, warm off-white highlights,
  acid lime as the single focal color.

**Light variation** (wellness, personal, reflective topics): background `#F5F3EE`, surface
`#FFFFFF`, text `#111318`, muted `#5F6670`, line `#D4D0C8`, same accents, borders at 3px. Pick
one mode for the whole video.

---

## Typography

- **Display:** `"SF Pro Display"` / `"Geist"`, weight 750–900. Hero 88–132px, scene 68–96px.
- **Body:** `"SF Pro Text"` / `"Geist"`, weight 400–550. 28–38px, line-height 1.2–1.4.
- **Data:** `"SF Mono"` / `"IBM Plex Mono"`, weight 500–700. Large stats 150–280px, tabular.
- **Label / kicker:** 20–24px, uppercase, tracking 0.08–0.14em.
- **Captions:** 46–62px, two lines maximum, inside the bottom safe area.

Two families maximum, one sans plus one mono. Headlines under eight words, broken by meaning.
One accent-colored phrase per frame — not every keyword. No gradient text, no outlined body
text, no more than three weights in a frame.

---

## Components

**Cards.** Radius 18–34px by size. Background `--surface`, raised content `--surface-raised`.
Border `1px solid --line` at rest, accent border when active. No shadow heavy enough to read as
a separate layer.

**Kicker + rule.** Uppercase `--muted` label above the subject; a 180×3px accent rule under a
headline. These are the two pieces of chrome allowed to repeat across scenes.

**Bullets.** A short accent dash or a drawn mark, never a filled disc. Cap lists at four items.

**Line art.** Stroke 3–8px scaled to the shape, round caps and joins, `fill: none`. Outline
shapes draw themselves rather than fading in.

**Badges, buttons, device frames, and the infographic system** (big-number stat, process flow,
before/after, comparison, timeline, app demo) follow `templates/STYLE.md`. Use one infographic
form per scene and vary the form across the video.

---

## Backgrounds

- **Base:** `--ink`.
- **Subject pool:** `radial-gradient(1200px 900px at 50% 34%, #15181D 0%, #0B0D10 62%)` so the
  subject lifts off a flat black frame.
- **Vignette:** `radial-gradient(760px 1180px at 50% 42%, transparent 55%, rgba(0,0,0,0.7) 100%)`.
- **Full-bleed stills:** cover-fit the full frame with a slow camera move, always under the
  vignette, never over it.
- One persistent background clip runs the whole timeline, so scenes cross-fade over a shared
  ground instead of flashing.

Each scene carries three depth layers: background field, midground message, foreground labels
and marks. Two focal points per frame so the eye has somewhere to travel.

---

## Motion

Deliberate and unhurried. Nothing bounces for decoration.

- **Ease vocabulary — three roles, no more.** `power2.out` for arrivals and exits.
  `back.out(1.7)` for the few things that land with weight. `none` for constant-speed strokes
  and camera moves.
- **Duration.** Entrances 0.3–0.45s. Self-drawing strokes 0.5–1.5s. Camera moves run the length
  of their scene.
- **Motion reveals meaning.** Staged entrances, drawn strokes, camera pushes, state changes. If
  a thing moves, it means something. No idle wobble.
- **One blueprint per scene, varied across the video.** If two consecutive scenes arrive the
  same way, one of them is wrong.
- **Cuts vs cross-fades.** Hard cut on a change of subject. A 0.5s cross-fade only between
  related ideas. Never fade to black mid-video.
- **Rhythm.** Default for six scenes: fast → fast → hold → fast → peak → hold.
- **Seek-safe properties only:** `opacity`, transforms (`x`, `y`, `scale`, `rotation`),
  `color`, `backgroundColor`, `borderRadius`, `strokeDashoffset`. Never `width`, `height`,
  `top`, `left`, or `filter`.
- **Deterministic:** no `Math.random()`, no `Date.now()`, no infinite repeats. Every frame is a
  pure function of timeline time.
- **The last frame is readable.** Hold a composed closing card. Never end on black.

---

## Captions

- One caption per spoken beat, timed from `narration.timing.json` — measured, never estimated.
- `--paper`, 46–62px, weight 600, centered, max-width 880px, two lines maximum.
- They rise ~26px over 0.36s on `power2.out`. No sideways slide, no scale.
- Safe area: 72px from the sides, 120px from the top, 160px from the bottom. Captions sit in
  the lower third, clear of platform UI.

---

## Generated Stills

Stills come back **wordless**. No lettering, numbers, labels, signage, logos, watermarks, or
interface anywhere in the frame — every surface that would normally carry writing is blank. All
text in the finished video is real type added in the composition, so it stays sharp, editable,
and correctly timed.

- One dominant subject, one supporting element, deliberate negative space in the lower third for
  the caption zone.
- Separable foreground, subject, and background planes so a camera move reads as depth.
- Same palette as above. A still that comes back in the wrong color world gets re-rolled, not
  color-corrected in the composition.
- Prompts are written as descriptions of what should be present. The generator routes anything
  phrased as a prohibition to the negative side, so prompts here never say "no text".

---

## Build Contract

The non-negotiables the renderer enforces. Everything above is taste; this is mechanics.

- Root element carries `data-composition-id`, `data-width`, `data-height`.
- Every timed element carries `class="clip"` plus `data-start`, `data-duration`, and
  `data-track-index`. Track index controls z-order.
- One GSAP timeline, created `{ paused: true }`, registered on
  `window.__timelines["<composition-id>"]`. The runtime seeks it; it never plays itself.
- Never tween a `.clip` element directly — the framework owns clip visibility. Animate an inner
  wrapper instead.
- Audio and video are framework-owned via `data-*` attributes, never driven from script.
- Once a scene runs past roughly 350 lines, split it into `compositions/*.html` and mount it with
  `data-composition-src`. Repeated cards belong in a sub-composition with
  `data-composition-variables`, fed per instance by `data-variable-values`.
- `npx hyperframes check` passes with zero errors before anything renders. Capture a midpoint
  snapshot per scene and read the contact sheet before calling it done.
- Final masters render with `--docker` for a deterministic Chrome and font set. Iterate locally
  at draft quality.

---

## STORYBOARD

One row per spoken line. Timestamps come from `public/audio/narration.timing.json`. Review this
before building.

**Scene map**

| Time | Backdrop | Beat | Blueprint |
| --- | --- | --- | --- |
| 0.00–0.00 | | | |
| 0.00–0.00 | | | |

**Beats**

1. **[Name] · 0.00–0.00.** What is on screen, what moves, and what the viewer understands by the
   end of the beat. Name the one dominant element and the one supporting element. State the
   animation blueprint and why it differs from the scene before it.

2. **[Name] · 0.00–0.00.** …

**Closing card · 0.00–end.** The held final frame: title, rule, and one line of call to action.
Must read as a still.
