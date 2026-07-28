# Topic-to-YouTube-Short asset-pack prompt

Replace the values in the input block, then give this entire prompt to an AI agent.
Only `TOPIC` is required. The agent should make reasonable decisions for blank fields.

---

## Input

```text
TOPIC: {{What is the video about?}}
MAIN_MESSAGE: {{What should the viewer understand or believe?}}
AUDIENCE: {{Who is this for?}}
CTA: {{What should the viewer do next?}}
BRANDS_OR_LOGOS: {{Brands, products, people, or organizations shown}}
SOURCE_MATERIAL: {{URLs, notes, documents, repositories, or "none"}}
REQUIRED_FACTS: {{Claims, examples, statistics, or "research them"}}
VISUAL_DIRECTION: {{Mood, references, colors, or "choose for me"}}
OUTPUT_NAME: {{short-kebab-case-name}}
DURATION_SECONDS: {{60}}
ASPECT_RATIO: {{9:16}}
```

## Assignment

Create a complete, reusable asset pack for a narrated YouTube Short about `TOPIC`.

Do not stop after proposing ideas. Research, write, create, validate, and package the actual files.
The completed ZIP must be ready to hand to another AI agent that will build the video.

If an input is blank, make a sensible decision and record it in the README. Ask a question only
when the topic itself is missing or a factual ambiguity would materially change the story.

## Project context

- Default destination: YouTube Shorts.
- Default canvas: 1080×1920, vertical 9:16.
- Default duration: 60 seconds.
- Default frame rate: 30 fps.
- This asset pack feeds a HyperFrames-based video pipeline.
- Read the pipeline's `templates/STYLE.md` when it is available.
- This task creates the script and assets, not the final rendered video.

## Research and accuracy

1. Research the topic before writing the script.
2. Prefer primary sources:
   - Official documentation for product behavior.
   - Official websites for company and product facts.
   - Original papers or datasets for research claims.
3. Do not invent statistics, features, quotations, customers, or results.
4. Put source URLs in `SOURCES.md`.
5. Clearly separate verified facts from creative metaphors.
6. If the topic involves local software, distinguish local files from cloud services.
7. If the topic involves an AI tool, name the exact product surface when it matters.

## Narration requirements

Write a natural voice-over that sounds spoken, not promotional.

- Target 130–145 words for a 60-second video.
- Every narration line must contain ten words to 15 words or fewer.
- Use one spoken idea per line.
- Use contractions where they sound natural.
- Vary line length and sentence rhythm.
- Write numbers the way the voice should pronounce them.
- Avoid jargon unless the audience needs it.
- Avoid fake excitement, vague hype, and generic introductions.
- Do not open with “Welcome,” “Introducing,” or “In this video.”

Use this story order:

1. Hook: state the viewer's problem, desire, or surprising outcome.
2. Promise: make the video's main value clear by the second beat.
3. Explanation: show why the idea works.
4. Example: demonstrate one concrete use.
5. Payoff: show the improved state or practical result.
6. CTA: give one small, specific next action.

Save the narration twice:

- `script/narration.txt` with one spoken beat per line.
- `script/SCRIPT.md` with the same script and delivery notes.

Run a word-count check. Run a separate check proving no line exceeds ten words.

## Storyboard requirements

Create `script/storyboard.md` with six scenes unless the topic clearly needs fewer.

The scene timings must add up exactly to `DURATION_SECONDS`.

Start with this rhythm and adapt it to the topic:

`fast hook → clear promise → setup build → practical example → visual peak → calm CTA`

For every scene include:

- Exact start and end time.
- Narration lines used.
- Scene concept and emotional job.
- On-screen headline, six words or fewer.
- Main visual metaphor.
- Background, midground, and foreground layers.
- Supplied assets used.
- Motion verbs for every important element.
- Transition into the next scene.
- Why the scene belongs in the story.

Each scene must feel like a visual world, not a web page.

## Visual direction

Create `STYLE.md` with:

- Exact color palette in hex.
- Background, foreground, muted, accent, warning, and data colors.
- Headline, label, caption, and code typography.
- 1080×1920 safe margins.
- Card, badge, button, device, and infographic styling.
- Motion timing and easing guidance.
- Texture, depth, and decorative-layer guidance.
- Clear “do” and “avoid” lists.

Use the requested `VISUAL_DIRECTION`. If it is blank, choose a direction that fits the topic.

Default quality target:

- Shadcn-style restraint.
- Presentation clarity.
- Fast, purposeful motion-graphics energy.
- Strong hierarchy and large phone-readable typography.
- At least two depth layers per scene.
- One dominant visual idea per scene.
- One visible accent color.
- No generic neon dashboard unless the subject truly calls for it.

## Asset creation

Create this structure:

```text
assets/
  logos/
  icons/
  infographics/
  backgrounds/
  templates/
```

### Logos

- Resolve official logos from authoritative or established vector sources.
- Prefer official brand kits, then SVGL or Simple Icons.
- Never redraw or regenerate a brand logo with an image model.
- Never distort logo proportions.
- Preserve the original SVG geometry.
- Record each logo's source and trademark note in `ASSET-NOTES.md`.
- If an official mark cannot be found, create `MISSING-ASSET.md`. Do not invent one.

### Custom vector assets

Create editable SVGs for the topic's important objects and actions.

The pack should usually include:

- One primary device, environment, or object illustration.
- One interface, terminal, code, document, or process illustration.
- Three to five topic-specific infographics.
- One 1080×1920 safe-frame template.

Do not create generic diagrams. Each infographic must explain a real part of the story.

Useful patterns include:

- Source → process → result.
- Before → after.
- Three-step loop.
- Folder or hierarchy map.
- Timeline.
- Comparison.
- Knowledge or relationship graph.
- One large verified statistic with a proportional visual.

Infographic rules:

- Use large labels.
- Keep labels editable.
- Use thick paths and simple shapes.
- Use arrows only when direction matters.
- Avoid pie charts.
- Avoid multi-axis charts.
- Avoid six-panel dashboards.
- Avoid chart-library defaults, gridlines, and tiny legends.
- Use exact HTML or SVG text for all information.

### Generated images

Use an available image-generation model only when a scene benefits from atmospheric depth,
photographic material, illustration, or a difficult-to-draw environment.

Image models must not generate:

- Readable text.
- Statistics or numbers.
- Logos.
- Finished charts.
- Interface labels.
- Watermarks.

For every generated or proposed image:

- Use the requested aspect ratio.
- Leave intentional negative space for HTML typography.
- Separate foreground, subject, and background for parallax.
- Keep the dominant subject clear on a phone screen.
- Record the exact prompt and model in the asset notes.

Also create `prompts/image-prompts.json`, even when images are optional.

Each prompt must include:

- Scene ID.
- Story purpose.
- Main subject.
- Action or transformation.
- Camera and composition.
- Negative-space location.
- Foreground, subject, and background separation.
- Palette and material direction.
- “No text, no numbers, no logo, no watermark.”

## Required files

The completed folder must contain:

```text
README.md
AGENT-INSTRUCTIONS.md
STYLE.md
SOURCES.md
ASSET-NOTES.md
asset-manifest.json
PREVIEW.png
script/
  narration.txt
  SCRIPT.md
  storyboard.md
assets/
  logos/
  icons/
  infographics/
  backgrounds/
  templates/
prompts/
  image-prompts.json
examples/
```

`examples/` should contain one real, topic-specific example the video agent can show on screen.
Examples can be a code file, note, configuration, document, data sample, or mini workflow.

## Agent instructions

Create `AGENT-INSTRUCTIONS.md` for the downstream video-building agent.

It must say:

- Read the script, storyboard, style guide, sources, and manifest first.
- Use supplied SVGs for exact logos, diagrams, labels, and information.
- Use generated images only as visual ingredients.
- Keep important content inside vertical safe margins.
- Prefer transform and opacity animation.
- Support reduced motion.
- Keep the final CTA visible for at least four seconds.
- Preserve factual distinctions from the sources.
- Show a preview before rendering the final video.

## Manifest and provenance

Create `asset-manifest.json`.

Each asset record must contain:

```json
{
  "id": "stable-id",
  "path": "relative/path/to/file",
  "type": "logo|icon|infographic|image|template|example",
  "scene": "scene-id or shared",
  "description": "what the asset communicates",
  "source": "original|official-url|provider",
  "editable": true
}
```

Create `ASSET-NOTES.md` with:

- Logo provenance.
- Image provenance and prompts.
- Trademark notes.
- Which custom vectors are original.
- Any usage limitations.

## Visual verification

Before packaging:

1. Parse every JSON file.
2. Parse every SVG as XML.
3. Confirm every path in `asset-manifest.json` exists.
4. Confirm narration is within the target word count.
5. Confirm every narration line has ten words or fewer.
6. Render every SVG to a PNG preview.
7. Inspect a contact sheet for:
   - Clipped labels.
   - Broken paths.
   - Weak contrast.
   - Tiny phone-unreadable text.
   - Distorted logos.
8. Save the contact sheet as `PREVIEW.png`.
9. Correct any visual problem before packaging.

## ZIP delivery

Package the folder as:

```text
{{OUTPUT_NAME}}-asset-pack.zip
```

The ZIP must contain one root folder:

```text
{{OUTPUT_NAME}}-asset-pack/
```

Exclude:

- Dependency folders.
- Private environment files.
- API keys.
- Temporary previews.
- Tool caches.
- Hidden provenance databases.

Run an archive integrity test after creating the ZIP.

## Final response

Return:

1. A clickable path or download link to the ZIP.
2. A clickable path to `script/SCRIPT.md`.
3. A clickable path to `script/storyboard.md`.
4. The asset count and narration word count.
5. A preview image.
6. Any missing official asset or unresolved factual limitation.

Do not claim success until the files exist and all validation passes.

---

## Example input

```text
TOPIC: Using Obsidian as a second brain for Claude Code
MAIN_MESSAGE: An organized vault gives Claude useful, durable project context.
AUDIENCE: Knowledge workers already experimenting with AI agents
CTA: Create one CLAUDE.md file and ask one useful question.
BRANDS_OR_LOGOS: Obsidian, Claude
SOURCE_MATERIAL: Official Obsidian Help and Claude Code documentation
REQUIRED_FACTS: Research them
VISUAL_DIRECTION: Editorial dark workspace, crystalline purple, warm human accent
OUTPUT_NAME: obsidian-claude-second-brain
DURATION_SECONDS: 60
ASPECT_RATIO: 9:16
```

