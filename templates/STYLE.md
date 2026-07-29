# YouTube visual and motion style

This is the default visual system for every video made with this pipeline. Treat it as the source
of truth for image generation, HTML composition, infographic design, typography, and motion.

The style in one sentence:

> Shadcn restraint, PowerPoint clarity, and After Effects energy.

The finished video should feel like a premium editorial presentation brought to life. It should not
look like a website recording, a stock template, a six-card dashboard, or a slideshow with simple
fades.

## Output format

- Canvas: 1920 × 1080, horizontal 16:9.
- Frame rate: 30 fps.
- Default duration: 10 minutes (600 seconds).
- Safe area: keep essential content at least 140 px from the sides, 60 px from the top, and 130 px
  from the bottom.
- Body text: no smaller than 28 px.
- Labels: no smaller than 20 px.
- Headlines: 72–132 px depending on length.
- One scene should communicate one main idea.
- The final frame must remain visible and readable. Never end on black.

## Creative principles

1. Lead with the viewer's problem or desired outcome, not the technology.
2. Deliver the main value by the second scene.
3. Use later scenes as proof: demonstrate the process, contrast, result, or example.
4. Let motion explain relationships. Do not animate elements simply because they exist.
5. Make every frame readable as a strong presentation slide before adding motion.
6. Keep the visual language consistent while changing the composition and motion pattern.
7. Use generated images as visual ingredients. Add exact words, numbers, UI, and charts in HTML.

## Story rhythm

Scene count follows narration line count, not a fixed number — a 10-minute default video runs far
more than six scenes. Use this shape as a percentage of the video's actual runtime:

| Beat | Runtime | Story job | Visual job | Motion character |
|---|---:|---|---|---|
| 1. Hook | 0–7% | State the pain, surprise, or desired outcome | One dominant visual and a short headline | Immediate slam, snap, or zoom |
| 2. Promise | 7–18% | Say what the viewer will gain | Transform the hook into a clear solution | Fast assembly followed by a hold |
| 3. How it works | 18–42% | Show the mechanism in simple steps | Process flow, device, or three-stage sequence | Precise clicks, draws, and fills |
| 4. Proof | 42–67% | Show a concrete result or example | App screen, before/after, or one meaningful stat | Camera push, scrub, or state change |
| 5. Payoff | 67–88% | Reveal the larger benefit | Full-frame result, comparison, or completed system | Peak motion and strongest transition |
| 6. CTA | 88–100% | Tell the viewer what to do next | One sentence, one action, one visual anchor | Assemble, settle, and hold |

Default rhythm: **fast → fast → hold → fast → peak → hold**, stretched across however many scenes
the narration actually needs within each beat.

Do not force a fixed scene count when the story is stronger with fewer or more. A scene that does
not support the main promise should be removed.

## Visual identity

### Core palette

Use these colors unless a specific brand palette overrides them.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0B0D10` | Main background |
| `--surface` | `#15181D` | Cards, panels, device frames |
| `--surface-raised` | `#20242B` | Elevated or selected content |
| `--paper` | `#F5F3EE` | Primary text and light scene panels |
| `--muted` | `#A7ADB7` | Supporting text |
| `--line` | `#343A44` | Dividers, borders, chart guides |
| `--accent` | `#D8FF63` | Main focal color and positive emphasis |
| `--warning` | `#FF6B57` | Mistakes, friction, negative comparison |
| `--data` | `#75A7FF` | Secondary data series only |

Rules:

- Use `--accent` once or twice per frame, not everywhere.
- Use `--warning` only when the story contains a real warning, failure, or "before" state.
- Use `--data` only when a second data series needs to be distinguished.
- Tint neutral surfaces toward cool charcoal. Avoid dead gray.
- Do not use purple-to-blue gradients, rainbow palettes, or full-screen linear gradients.
- A localized radial glow is allowed behind the focal element at 15–25% opacity.

### Light-mode variation

Use light mode for wellness, personal stories, education, food, or reflective topics:

- Background: `#F5F3EE`.
- Surface: `#FFFFFF`.
- Text: `#111318`.
- Muted: `#5F6670`.
- Line: `#D4D0C8`.
- Keep the same accent colors.
- Increase borders to 3 px and use a subtle paper grain so the scene does not feel blank.

Do not switch between light and dark scene by scene unless the change is part of the story.

## Typography

### Type roles

- Display: `"SF Pro Display"`, `"Geist"`, or a bundled geometric sans. Weight 750–900.
- Body: `"SF Pro Text"`, `"Geist"`, or system sans. Weight 400–550.
- Data and metadata: `"SF Mono"`, `"IBM Plex Mono"`, or a bundled monospace. Weight 500–700.

Use no more than two font families in one video. A single sans family plus one monospace is the
default.

### Hierarchy

- Hero headline: 88–132 px, tight line height between 0.88 and 1.0.
- Scene headline: 68–96 px, line height between 0.95 and 1.08.
- Body or narration support: 28–38 px, line height between 1.2 and 1.4.
- Label or eyebrow: 20–24 px, uppercase, 0.08–0.14 em tracking.
- Large stat: 150–280 px with tabular numerals.
- Captions: 46–62 px, two lines maximum, placed inside the bottom safe area.

Rules:

- Keep headlines under eight words whenever possible.
- Break lines by meaning, not merely to fit the width.
- Use sentence case for explanation and uppercase only for short labels.
- Highlight one phrase with the accent color. Do not color every keyword.
- Avoid gradient text, outlined body text, and more than three weights in a frame.

## Frame composition

Each produced scene should have three depth layers:

1. Background: solid field, localized glow, grain, grid, oversized ghost type, or structural line.
2. Midground: the message, infographic, app screen, or visual metaphor.
3. Foreground: labels, dividers, progress marks, captions, or a small accent that guides the eye.

Use two focal points so the viewer's eye has somewhere to travel. Examples:

- Headline at upper left and a large stat at lower right.
- App screen on the right and an explanatory process on the left.
- Before panel on the left and result panel on the right.
- Main number in the center and a proportional bar anchored to the bottom.

Anchor content to edges and zones. Avoid a single centered card floating in empty space.

## Shadcn-inspired component language

Borrow shadcn's clarity and restraint, then scale it for video.

### Cards

- Radius: 28–36 px.
- Border: 2–3 px solid `--line`.
- Surface: `--surface` or `--surface-raised`.
- Padding: 44–64 px.
- Shadow: `0 28px 80px rgba(0, 0, 0, 0.34)`.
- Use one large card or two contrasting cards. Do not build a six-card dashboard.

### Badges

- Height: 44–54 px.
- Horizontal padding: 18–24 px.
- Radius: 999 px.
- Type: 20–22 px monospace or medium sans.
- Use for status, scene labels, dates, or a single category.

### Buttons and calls to action

- Height: 72–88 px.
- Radius: 22–28 px.
- Padding: 26–36 px.
- Primary CTA uses `--accent` with dark text.
- Secondary CTA uses a transparent surface and a 2 px border.
- Animate a CTA as a physical object: press, release, settle.

### App and device screens

- Use a phone frame with 44–56 px corner radius and 8–12 px bezel.
- Add a soft edge reflection or narrow highlight, not a glossy fake mockup.
- Enlarge the important app region. A full app screenshot shown at actual scale is too small.
- Use a parent wrapper for entrances and a child layer for internal scroll or zoom.
- Never embed a live iframe. Use a captured local image.

## Infographic system

Infographics must be understandable within three seconds. Use one of these patterns per scene.

### Big-number stat

- One large number.
- One short label.
- One proportional visual: fill bar, ring, stack, or shape.
- One source label only when a real source is available.
- Animate the number and proportional visual together.

### Process flow

- Maximum three visible stages at once.
- Use a line or path to connect them.
- Reveal in causal order: node → connector → next node.
- Use verbs for stage labels.
- A moving pulse may travel along the path once.

### Before and after

- Two panels maximum.
- Keep geometry consistent so the changed state is obvious.
- Use `--warning` for the before state and `--accent` for the after state.
- Transition with a wipe, fold, slider, or shared-anchor morph.

### Comparison

- Compare no more than three items.
- Choose one visual variable: height, length, position, fill, or scale.
- Keep all labels close to what they describe.
- Reveal the winner last.

### Timeline

- Show three to five moments.
- Use one directional path.
- Move the camera or playhead through the moments instead of revealing the entire timeline at once.

### App demonstration

- Show one action and one result per scene.
- Use cursor movement only when the pointer clarifies the action.
- Couple the control and its result on the same beat.
- Crop tightly around the relevant interface.

### Infographic rules

- No pie charts.
- No multi-axis charts.
- No legends detached from the data.
- No tiny ticks or gridlines.
- No chart-library defaults.
- Build exact data with HTML, CSS, SVG, and GSAP.
- Preserve the same visual space when values change over time.
- Pair every number with a visual element that gives it weight.

## Image-generation contract

Image generation creates the visual world, not the finished infographic.

### What the image model should create

- Editorial illustrations and visual metaphors.
- Background environments.
- Isolated subjects and objects.
- Material textures.
- Simple scenes with one dominant focal point.
- App-adjacent imagery that leaves room for a real HTML device frame.

### What HTML or SVG must create

- Headlines, captions, labels, and call-to-action text.
- Exact numbers and percentages.
- Charts, bars, timelines, and process arrows.
- Logos and brand marks.
- Real app screens.
- Buttons, badges, tabs, and other interface components.

### Prompt formula

Write image prompts in this order:

1. **Story function:** what this image helps the viewer understand.
2. **Subject and action:** one clear subject doing one clear thing.
3. **Composition:** foreground, background, camera angle, and empty space.
4. **Medium:** editorial 3D, cut paper, product photography, ink diagram, or another named medium.
5. **Palette and lighting:** use the fixed palette and one lighting direction.
6. **Motion potential:** identify the layers that can move separately in HTML.
7. **Technical constraints:** 16:9, 2K, safe margins, no text, no logos, no watermark.

### Base style suffix

Append this to every prompt:

> Premium editorial visual for a horizontal 16:9 technology explainer. Charcoal-black environment,
> warm off-white subject highlights, acid-lime focal accent, restrained cobalt only when a second
> data color is necessary. Strong silhouette, cinematic depth, crisp material detail, one dominant
> subject, uncluttered background, and deliberate negative space for large HTML typography.
> Separate foreground, subject, and background planes for parallax. Screen-safe composition, 2K,
> no readable text, no numbers, no charts, no interface labels, no logo, no watermark.

For light-mode stories, replace the charcoal environment with warm paper and keep strong dark
structural lines.

### Prompt templates

#### Hook

> Create a visual metaphor for [viewer problem or desired outcome]. Show [single subject] [clear
> action]. Use an extreme close-up or low-angle composition with the subject occupying the lower
> two-thirds. Leave clean negative space in the upper-left for a short headline. [Base style
> suffix.]

#### Process

> Create three clearly separated physical stages representing [stage one], [stage two], and [stage
> three], connected by one directional path. No labels or text. Compose the stages diagonally from
> lower-left to upper-right so HTML nodes and arrows can be overlaid. [Base style suffix.]

#### App showcase

> Create a cinematic environment around an empty vertical phone-shaped focal area. Place supporting
> objects that suggest [use case] around the perimeter, with the center-right kept clean for a real
> app screenshot. Do not generate an interface inside the phone area. [Base style suffix.]

#### Before and after

> Create one continuous scene split into two matching states. The left side represents [before];
> the right side represents [after]. Keep the same camera and subject position so an HTML wipe can
> reveal the transformation. Do not include divider lines or labels. [Base style suffix.]

#### CTA

> Create a completed, upward-feeling composition for [final benefit]. One strong object sits in the
> lower half while the upper half remains calm and open for a one-line call to action. The scene
> should feel resolved, not celebratory or cluttered. [Base style suffix.]

### Image-generation rejection checklist

Reject and regenerate an image when:

- It contains fake text, numbers, logos, or watermarks.
- It looks like a finished dashboard or generic stock infographic.
- It has more than one equally dominant subject.
- The palette changes without a story reason.
- The important subject touches a screen-safe edge.
- There is no usable negative space for typography.
- Foreground and background cannot be separated for motion.
- The image depends on tiny detail that will disappear on a phone.

## Motion language

Motion should feel fast and intentional, like a polished After Effects package built from clear
presentation slides.

### Scene phases

Every scene has three phases:

- Build, 0–30%: stagger the important elements into view.
- Breathe, 30–70%: hold the message and use one ambient motion.
- Resolve, 70–100%: exit decisively or prepare the handoff.

The first-moving element is perceived as the most important. Animate in story order, not DOM order.

### Timing

- Micro hit: 0.15–0.25 seconds.
- Fast entrance: 0.25–0.4 seconds.
- Main entrance: 0.4–0.65 seconds.
- Hero reveal: 0.65–0.9 seconds.
- Exit: 0.15–0.35 seconds.
- Scene transition: 0.2–0.5 seconds.
- Total item stagger: under 0.5 seconds.
- Leave at least 1.2 seconds of readable hold after a major statement.

Entrances should be slower than exits. Do not start every scene at its first frame; allow a
0.1–0.25 second visual breath.

### Recommended motion patterns

Use two to four patterns per scene:

- Kinetic beat slam for hooks and emphatic phrases.
- Waterfall entry for short lists and title sequences.
- SVG path draw for processes, diagrams, and timelines.
- Stat count plus proportional bar or ring.
- Camera push toward an app screen or important result.
- Split tilt cards for comparisons.
- Control-target sync for app demonstrations.
- Card morph for transitions between idea and result.
- Depth scatter and assemble for a final synthesis.
- Ambient glow bloom for a hero hold.

### Easing

- Entrances: `power3.out`, `power4.out`, `expo.out`, or restrained `back.out`.
- Exits: `power2.in` or `power3.in`.
- Movement between states: `power2.inOut` or `sine.inOut`.
- Ambient motion: `sine.inOut`.
- Use at least three motion directions or entrance types in a full video.
- Do not use the same ease on every element.

### After Effects feel in HTML

Create the sense of compositing with layers:

- Put camera motion on a `.world` wrapper.
- Put the subject entrance on a parent wrapper.
- Put slow image drift or zoom on the child image.
- Put text, rules, and data on separate foreground layers.
- Use masks and `clip-path` for reveals.
- Use SVG strokes for diagrams.
- Add directional blur only during high velocity, then resolve to sharp.
- Use short overshoot on objects that should feel tactile.
- Keep glows localized and tied to a meaningful focal element.

Never run conflicting transform animations on the same element. Split camera, entrance, and ambient
motion across nested wrappers.

## Scene transitions

Use transitions as story punctuation:

- Hard cut: surprise, contradiction, fast list, or register change.
- Directional push: progression or moving to the next step.
- Zoom through: moving deeper into an idea or interface.
- Blur through: switching context while preserving energy.
- Shared-anchor card morph: idea becoming a result.
- Split wipe: before becoming after.
- Crossfade: only when two images represent a true continuation.

Use one or two high-impact transitions per video. Too many effects flatten their impact.

Match velocity across a moving cut. The outgoing scene accelerates away; the incoming scene enters
at a similar speed and decelerates into place.

## HyperFrames implementation rules

- Use direct-child `.clip` scenes with explicit `data-start` and `data-duration`.
- Register exactly one paused GSAP timeline.
- Use deterministic `fromTo` tweens with explicit start and end states.
- Do not use unseeded randomness, wall-clock time, infinite repeats, or autoplay timelines.
- Do not animate `width`, `height`, `top`, or `left`. Use transforms, masks, and SVG.
- Let HyperFrames control clip visibility.
- Put media playback under HyperFrames control.
- Use finite, seek-safe ambient motion.
- Inspect scene-midpoint snapshots and the complete preview before rendering.

## Quality review

Review the video with the sound off:

- Is the viewer's problem clear in the first four seconds?
- Is the value understandable by scene two?
- Does every scene have one unmistakable focal idea?
- Can every headline be read on a phone?
- Does each number have a visual counterpart?
- Are app screens cropped tightly enough to understand?
- Does the eye move through at least two focal points?
- Does the motion explain the story instead of decorating it?
- Are the fastest and slowest moments at least three times different in pace?
- Does the CTA remain visible long enough to act on?

Review the contact sheet:

- Every scene should clearly belong to one visual system.
- Layouts should vary: split, full-frame, data-led, app-led, and closing.
- The accent color should guide the story rather than coat every frame.
- No frame should look like a website dashboard or generic slide template.

Review the final preview:

- No blank frames, clipped type, unexpected flashes, or late-loading assets.
- Narration, text, and visual changes land on the same beats.
- Transitions preserve direction and do not interrupt comprehension.
- The final frame is readable and does not fade to black.
