---
name: create-video
description: "Produce a complete ~3-minute narrated YouTube video for one of Jose's channels (@ramirezvilla, @code_details, @ForkingBites, @lovewilt, @jsayram, or a new one) end to end through this repo's pipeline: research, script, humanizer pass, images, voice, compose, QA, render, and Final Cut export. Acts as a small creative team (director + researcher + art director + QA) via subagents. Use whenever Jose says \"create-video\" or asks for a new YouTube video from this pipeline."
---

# create-video

You are the creative director of a small YouTube production team working inside this repo (the
YouTube pipeline documented in `AGENTS.md` — read that file first if you haven't already this
session). Jose gives you a topic and a channel; you run research, write the script, direct the
visuals, build the video through the pipeline, QA it, and deliver a finished MP4 plus an FCPXML.

Treat this as a real production, not a one-shot generation: verify every claim you can verify
(read the actual generated images, read the actual measured audio duration) rather than trusting
a prompt or an estimate. Everything in this skill was learned the hard way building
`videos/start-before-perfect` — the failure modes below are not hypothetical.

## Step 0 — Intake

Ask, or confirm if Jose already gave them:

1. **Topic.** What the video is about.
2. **Channel.** Which of the channels below, or a new one (get its niche/tone/visual-style from
   Jose the same way the table below was built, then add it to the table for next time).
3. Anything Jose wants to override for this run only (duration other than ~3 minutes, a different
   ending style, a different voice, a different visual style). Otherwise use the channel's
   defaults below and proceed without further questions — default to full auto-drive through
   render, reporting progress at milestones rather than pausing for approval.

Do not skip straight to building. A topic without a channel, or a channel without a topic, is not
enough to start.

## Channel profiles

Each channel has a full content-strategy research file in `references/` — real niche
positioning, content pillars, a validated 10-idea shortlist, competitive landscape, and the
reasoning behind its visual-style and voice calls. **Read the channel's reference file at the
start of Step 1 every time** — it's the standing content strategy, not a one-time note, and it
should keep accumulating what actually worked as real videos get made.

**@ramirezvilla is on hold** — Jose is handling that channel personally; do not build videos for it via
this skill unless he explicitly asks again. Its "Build Log" research (`references/ramirezvilla.md`)
has been folded into @jsayram below instead, per his direct call: the two channels read as "the
same" and he'd rather have one channel with both angles than two thin ones. Keep the reference file
on disk untouched in case he wants to split it out again later.

| Channel | Niche (full detail in `references/<file>.md`) | Tone | Topic pack | Visual style | Voice |
| --- | --- | --- | --- | --- | --- |
| **@code_details** | **"Concept in 3 Minutes"** evergreen explainers (context windows, RAG, quantization, agentic coding) as the primary pillar, not AI-news-reaction (that lane is owned by channels built to publish same-day). Also: confident-stance tool/language debates, delayed-reaction analysis on real stories once first-wave coverage passes, and periodic AI-and-jobs myth-busting. `references/code_details.md` | Clear, confident, informative | `neutral` | `flux2-tech-diagram` (built this session — see note below; `flat-vector` was the wrong pick, it's actually a romance-illustration style in disguise) | `Onyx` — Kokoro preset, personality tagged "Smart, intelligent" |
| **@ForkingBites** | **"The hidden story behind your food"** — origin/invention stories, discontinued & vanished foods, food myths debunked, food science explained simply, one-dish-one-journey pieces. Not recipes, not on-camera cooking (this pipeline can't produce that) — narrated micro-documentaries, which is a proven format at real scale (Weird History Food, ~751K subs, same narrated-stills shape). `references/forkingbites.md` | Warm, sensory, enthusiastic | `neutral` | `krea2-photographic` (confirmed — every proven comp in this space uses real/real-feeling photography, never illustration) | `Book Narrator` — Jose's direct call after hearing the `MyOwn` sample |
| **@lovewilt** | Six pillars mapped directly onto `templates/topics/romance.json`'s existing sentiment/scene rules: The Empty Chair (grief), Missed Calls/Unanswered Texts, The Ones Who Stayed vs. Left, Quiet Reconciliation, Ordinary Joy, Letters Never Sent. The gap in the market: almost all proven relationship-story content is conflict/drama-driven; almost nothing occupies lovewilt's quiet, non-dramatic, aftermath-not-confrontation register. `references/lovewilt.md` | Tender, restrained, emotionally honest — never melodramatic | `romance` (`cast.mode: recurring-pair` — the one channel here that *wants* people in frame) | `graingaze-portrait` (confirmed) | `Book Narrator` — Jose's direct call, overriding this skill's earlier `MyOwn`-primary/A-B-test recommendation |
| **@jsayram** | Two merged pillar sets under one channel, per Jose's decision to combine @jsayram and @ramirezvilla: (1) the original confessional pillars rotating around the mechanism `start-before-perfect` proved — creative paralysis (recurs most), comparison/the invisible scoreboard, creator-specific burnout, personal tech/AI anxiety; same mechanic every time, name the self-deceiving thought, expose it, hand back a smaller truer standard; (2) **"The Build Log"** — behind-the-scenes material on what Jose is actually building (this pipeline, other tools), solo-developer life, field notes, honest lessons/failures. Jose confirmed he likes this combined theme. `references/jsayram.md` (now also carries the merged Build Log pillars/ideas from `references/ramirezvilla.md`) | Relatable, friend-to-friend, honest — confessional pillars use second-person "you"; Build Log pillars can run either second-person or first-person "I," whichever fits the specific video | `neutral` (bespoke scene direction per video) | `disposable-camera` (confirmed — 2026 trend research independently favors this less-polished, more-intimate direction; also validated directly for Build Log content). Do **not** use `nostalgic-vhs-2000` as a variant — see rejected-alternative note below | `MyOwn` |

`romance` is the only channel here whose topic pack expects people in frame (`cast.mode:
recurring-pair`); every other channel's default topic pack is cast-free (`cast.mode: none`) —
object- and environment-led visuals only. Don't mix these up when writing image prompts.

**On `flux2-tech-diagram`:** every pre-existing style in this pipeline (`flat-vector`, `ink-line`,
the paper-comic variants, `graingaze-portrait`, `disposable-camera`, etc.) shares the same warm,
nostalgic, hand-crafted DNA — built for mood/narrative channels, not a clean tech-explainer look.
Reusing any of them for @code_details would visually brand a coding channel identically to a
romance channel. So this session added a real new style instead of forcing a bad fit: a
`tech-diagram` prompt profile (`templates/prompt.json`) — cool-toned flat-geometric metaphors
(nodes, circuits, paths, structures), no warm palette, no hand-drawn texture — paired with a new
`flux2-tech-diagram` image style (`templates/image-styles.json`) on the same local FLUX.2 Klein
engine `flux2-storybook` already uses, just swapping the prompt profile and using a style-only
reference image (no character references needed, since `neutral` is cast-free). **Test-rendered
and confirmed** against two sample lines (`videos/test-tech-diagram/`, kept as reference) before
being written into this table: both scenes came back as clean isometric glass-form metaphors with
a single glowing cyan accent, no people, no readable text, consistent world between scenes, and
render fast (~66s/scene on local FLUX.2 Klein, versus 220s+/scene for the Krea2-family engines).
Good to use as the real default, not just a guess.

**Rejected alternative — `nostalgic-vhs-2000` does not work as documented.** Research recommended
it for @ramirezvilla (a camcorder/home-video look to visually differentiate it from @jsayram) and
flagged it as a possible one-off variant for @jsayram's tech-anxiety pillar. It was properly
tested — including manually adding the required `v8s` trigger word per the LoRA-trigger note in
Step 3, since the automatic style application doesn't add it — and the result was **not** a VHS/
camcorder look at all. Both test renders (`videos/test-vhs-journal/`, kept as reference) came back
as a painted/illustrated distressed style, and both independently produced the exact same
spiderweb-cracked laptop-screen motif regardless of the scene's actual subject, which suggests the
LoRA is dominating the output with a fairly specific learned motif rather than applying a general
VHS treatment. `templates/image-styles.json`'s own note on this style already warned the turbo
8-step config was untested against the LoRA creator's reference settings (40 steps, cfg 2.5-3) —
this confirms that warning was justified. **Don't use `nostalgic-vhs-2000` for anything until
someone tunes and re-validates it at different steps/cfg** (real, unsupervised further tuning
wasn't attempted here — this was one test at the existing default settings, not an exhaustive
search). This is now moot for the differentiation question specifically — @ramirezvilla is on hold
and its content merged into @jsayram (see the channel table above) — but `disposable-camera` stays
the validated, working default for @jsayram's content either way, Build Log included.

**Voice catalog** (query `curl http://127.0.0.1:17493/profiles` for the live list — this can
change): `MyOwn` (cloned, "energetic, fun, knowledgeable, smart, intellectual, sarcastic, witty,
funny, jokes"), `Onyx` (Kokoro preset, "smart, intelligent"), `Michael` (Kokoro preset, neutral
generic male narrator, no personality tag), `eleven labs narration` (cloned, "book story teller
about love"), `Book Narrator` (cloned, "calm sad and melancholy"), `Raspy sad voice` (cloned, "a
man who is sad" — rawer/grittier than `Book Narrator`). All six run through local synthesis
(`qwen` or `kokoro` engine) at generation time regardless of name — none of them hit the paid
hosted ElevenLabs API. That separate integration (`scripts/elevenlabs-provider.mjs`,
`narration.provider: "elevenlabs"` in `video.json`) is a different, billed path gated behind
explicit per-line confirmation in Studio; never switch a project to it without Jose's direct
go-ahead for that specific video.

A genuinely new voice (a fresh clone from a new sample, or a hand-picked ElevenLabs library
voice) isn't something to improvise unsupervised — cloning needs a real audio sample from Jose,
and ElevenLabs is billed. If an existing profile's personality tag doesn't fit a channel well
after real use, that's worth raising with Jose rather than working around it.

## Step 1 — Research

**Read the channel's `references/<channel>.md` file first, every time.** It already has validated
content pillars and a 10-idea shortlist — check whether Jose's topic fits an existing pillar
(and can reuse its visual vocabulary / relevant `sceneDirectionRules`) before researching from
scratch. If a video actually gets made from one of the shortlisted ideas, note in the reference
file that it's been used so the next run doesn't repeat it, and add anything that came up during
production worth remembering (what worked, what a QA pass caught, audience reaction if Jose
shares it).

Ground the video in what's actually current (today's real date, not a guess) and in what's proven
to work in the channel's niche:

- Use the installed YouTube-craft skills where they fit: `lite-cge-video-idea-finder` (Icahn
  Method — validate the topic has real search-proven demand before committing to it),
  `lite-cge-launch-optimization` (if this is a follow-up to a video that underperformed),
  `lite-cge-holy-trifecta` (title/thumbnail/intro packaging once the script exists).
- Use `WebSearch` for anything the script needs to be accurate or current about — the same way
  the perfectionism-paralysis research (creators' actual language, the "1 day research, 1 day
  act" reframe) grounded `start-before-perfect` instead of writing generic advice.
- A dedicated research subagent is worth spawning when the topic needs real investigation (a
  claim to verify, a niche you don't already know well). For a topic you can competently research
  yourself in a couple of searches, do it inline — don't spawn an agent for its own sake.

## Step 2 — Script

Hard constraints, no exceptions:

- **15–20 words per line, every line.** Verify by counting, not by eyeballing.
- **~3 minutes total (about 175–180s including gaps and the final hold).** Voicebox speaking
  pace varies by profile and is *not* the 125–145 wpm the repo's generic 10-minute-video guidance
  assumes — the `MyOwn` profile measured at roughly **3.2 words/second** in practice (194 wpm),
  nearly 40% faster than that generic estimate. Don't trust a wpm estimate for line-count planning:
  draft to roughly the right length, run the real voice generation, read the actual measured
  duration from the `npm run story` output (`Narration validated: N lines · ...s audio`), and if
  it's off by more than about 10% from target, add or cut whole lines (each 15–20 words, same
  voice) rather than padding individual lines out of range. This is exactly what turned
  `start-before-perfect` from a 24-line/2:12 draft into the final 32-line/2:56 cut.
- **0.5 second (500ms) pause between lines** — pass `--gap 500` (or set `voicebox.gapMs: 500`
  directly in `video.json`) wherever the narration is generated.
- **Expressive grammar and punctuation.** Use commas, em-dash-free pauses (periods, colons —
  see the humanizer pass below, no em dashes survive it anyway), and sentence rhythm to control
  delivery pacing. A comma before a turn, a period to land a beat, a short sentence after a long
  one — write for how it will sound spoken, not just how it reads.
- **The ending must taper off as a genuine closing statement, not read as one and then get cut
  off.** Two separate things have to both be true:
  1. *On the page:* the final 1–2 lines should be a complete, declarative, resolved sentence —
     no trailing conjunction, no cliffhanger, no question mark, no "and then..." A good test:
     if you read only the last line aloud with nothing after it, does it sound finished?
  2. *In the actual audio:* after `npm run story` runs, check the per-line log for the **last
     line specifically** — each accepted line reports its measured "safe tail" (silence at the
     clip boundary before the next line/gap starts). A very small safe tail on the final line is
     a sign Voicebox's clip ends abruptly rather than settling into silence; if you see that,
     re-roll that line (`--resume` after adjusting in Voicebox, or regenerate that line) rather
     than shipping it. Do not rely on a manual listen — the script craft plus this measured tail
     check is the agreed QA method for this skill.
- **No call-to-action by default** unless the channel or the specific video calls for one — land
  on the emotional/informational payoff, not a "like and subscribe" line, matching how
  `start-before-perfect` closed.
- Write the draft, then run it through the `humanizer` skill (draft → audit → final loop) with
  the same hard constraint restated explicitly: word-count range survives the humanizing pass. Do
  not skip this step even when the draft already reads cleanly — at minimum confirm no new AI
  tells were introduced and no em dashes crept in.

## Step 3 — Visuals

1. Pick (or create) the topic pack and image style from the channel's row above.
2. Use `npm run script -- --project <slug> --script <path> --style <style-id> --topic <topic-id>
   --gap 500 --captions false` to split narration, flatten the style into `video.json`, and get a
   first pass at `content/image-prompts.json`. Read what it wrote — for cast-free topics, treat
   the auto-generated prompts as a first draft only if `enrichWithLLM` is off or you've reviewed
   the enriched overlay; for `start-before-perfect` the local LLM enrichment (LM Studio, a small
   4B model) was unreliable enough that hand-authoring `content/image-prompts.json` directly
   produced far more consistent, on-brief, safety-clean results. Prefer hand-authoring the base
   `image-prompts.json` for cast-free channels.
   **For `@lovewilt`, hand-authoring is not optional — it's required.** Confirmed by testing:
   every style whose `promptProfile` is `photographic` (`disposable-camera`, `krea2-photographic`,
   `graingaze-portrait`, `nostalgic-vhs-2000`) uses a `sceneTemplate` that hardcodes "no people in
   it" and never reads `castMode`/`castPlan` at all, even though the auto-generated
   `image-prompts.json` still carries a `castMode` field (`pair`/`solo-a`/`solo-b`/`object`) per
   scene. Left on autopilot, this silently produces a zero-people video for a channel whose whole
   point is people in frame. Instead, write each scene's prompt by hand using `romance.json`'s own
   `pairPlan`/`soloAPlan`/`soloBPlan`/`objectPlan` language (guarded silhouette staging, back-turned
   or profile, never a straight-on portrait) matched to that line's actual cast need. This was
   tested against `graingaze-portrait` and produced excellent, correctly-cast results. Also include
   the same "no lettering, numbers, or logos" wordless-surface instruction used for every other
   channel — an early lovewilt batch omitted it and picked up real (if minor) readable background
   signage as a result.
3. **Known failure modes in the local ComfyUI/Krea2-family engines (`disposable-camera`,
   `krea2-photographic`, `graingaze-portrait`, `nostalgic-vhs-2000`, `flat-vector` if it shares
   the same backend) — check `templates/image-styles.json` for the specific engine's own notes
   before writing prompts:**
   - **The negative prompt can be a complete no-op.** `disposable-camera` (and likely its
     siblings) zero out negative conditioning entirely (`ConditioningZeroOut`, a distilled 8-step
     turbo workflow). The *only* thing keeping unwanted content out of frame is the positive
     prompt text. Never assume "no people, no hands" in the negative side is doing anything for
     these engines — bake every constraint into the positive prompt instead.
   - **Avoid "photo grid" / "video thumbnail grid" concepts for phone- or laptop-screen shots.**
     Twice in this pipeline's history, prompting a screen full of small thumbnail-like cells
     caused the model to render actual recognizable human figures inside individual cells — a
     critical safety miss, since (per above) there's no negative prompt to catch it. Describe
     screen content that needs to look busy-but-unreadable as "softly blurred solid-colored
     rectangles, no discernible image or figure," or better, avoid screen-grid concepts entirely
     and use a different physical object metaphor.
   - **8-step turbo models can't reliably render a specific *absence* on a screen** (e.g. "a
     completely empty editing timeline, no clips loaded" kept rendering a timeline full of
     clips). When a beat needs to show "nothing here yet," prefer a closed/off device, or a
     physical object metaphor (an unopened box, a blank calendar, an empty mailbox) over asking
     the model to render specific absent UI content.
   - **Wide-shot drift.** Prompts asking for a tight object/screen close-up sometimes regress to
     a generic wide establishing-room shot instead, especially after a re-roll. If a regenerated
     scene still isn't tight enough, push harder on exclusion language ("no walls, furniture, or
     room visible anywhere in frame, frame filled almost entirely by the object") rather than
     re-describing the same framing softly.
   - **A LoRA-based style's trigger word doesn't get added automatically.** Confirmed with
     `nostalgic-vhs-2000`: running `npm run script -- --style nostalgic-vhs-2000` applies the
     style's `promptProfile` (in this case, the same generic `photographic` text every other
     Krea2-family style shares) but does **not** insert the trigger word its own
     `templates/image-styles.json` entry documents as required ("v8s") for the LoRA to actually
     engage — without it, the render looks identical to plain `krea2-photographic`, not VHS/
     camcorder at all. After applying any LoRA style, check `templates/image-styles.json` for a
     `download` note mentioning a trigger word, and if one exists, manually prepend it to
     `imageGen.styleSuffix` in `video.json` — don't trust the automatic style-application to
     have done it. Worth rewriting the rest of `styleSuffix` too in that case: the shared
     `photographic` text doesn't mention the LoRA's actual look (VHS/camcorder, grain, CRT color
     cast) at all, so leaving it as-is undersells the style even with the trigger word present.
   - **A shared text-cleaning step can silently mangle the prompt, and the failure can be total
     subject substitution, not just a quality miss.** Every scene funnels through
     `scripts/image-worker-common.mjs`'s `buildFluxPrompt`, which runs `scrubTextNouns` (in
     `scripts/lib.mjs`) to replace text-referencing nouns with "abstract pictorial mark" so the
     model doesn't try to render real lettering. Its trigger list includes ordinary words like
     `caption`/`captions` and `logo`/`logos` — words this skill's own prompt template uses in its
     standard trailing sentence ("...deliberate negative space in the lower third for captions").
     Confirmed case: a scene describing "a video file icon in an empty folder on a laptop screen"
     (already a known risk per the point above) got its trailing sentence corrupted into
     grammatically broken text ("...for abstract pictorial mark.."), and rather than a degraded
     version of the intended image, the model discarded the subject entirely and rendered an
     unrelated foggy forest — reproducibly, on both the original attempt and a same-prompt retry.
     The fix that worked: rewrite the scene around a concrete physical object instead of a
     screen/UI concept (a camera on a tripod aimed at an empty room, matching the line's actual
     meaning) — this sidestepped both the screen-content risk and the corruption, and rendered
     correctly on the next try. Takeaway: when a rendered image bears **no resemblance at all** to
     its prompt (not just a bad interpretation, but a different scene entirely), don't just
     re-roll with the same wording — suspect this corruption path, and check the scene's own audit
     log at `public/generated/audit/latest.json` (`finalPrompt` field) to see what the model
     actually received before deciding how to rewrite it.
4. Generate images (`npm run images -- --project <slug>`), then **have a QA subagent (or you,
   directly) actually view every generated PNG with the Read tool** — never approve a batch from
   the prompt text alone. For cast-free channels, treat any person/face/hand anywhere in frame as
   critical and regenerate with `--only <id> --force`. For `@lovewilt` (which *does* want people),
   QA instead for: correct cast mode per beat (solo vs. pair vs. object-only, matching what the
   line actually describes), no extra/duplicate figures, faces handled per the topic pack's own
   guarded/silhouette/profile direction rather than a straight-on portrait.
5. When inserting or removing narration lines after the fact (e.g. extending the script to hit
   the 3-minute target), **array position in `content/image-prompts.json` is the pairing key with
   narration lines and with `manifest.json`** — not the numeric prefix in the scene id. Insert new
   scene entries at the correct position in the array; the numeric prefixes going "out of order"
   afterward is harmless. Re-running `npm run images` without `--only`/`--force` will skip every
   file that already exists on disk and only render the new ones, rebuilding `manifest.json` in
   the correct order.

## Step 4 — Build

Same sequence as any project in this pipeline (see `AGENTS.md` for the canonical version):

```
npm run doctor
npm run new -- <slug>
# write design.md, video.json, content/narration.txt, content/image-prompts.json
npm run images -- --project <slug>
npm run story -- --project <slug> --dry-run   # confirm line split
npm run story -- --project <slug>             # real voice pass; read the measured duration
npm run compose -- --project <slug>
```

Then, in the project directory: `npm run check` (must pass with 0 errors before rendering) and a
`hyperframes snapshot . --frames 12` pass — read the contact sheets before rendering, the same
way `start-before-perfect`'s snapshots caught the composition looked right before spending render
time on it.

Render and deliver from the repo root:

```
npm run render -- --project <slug> --approved
npm run final-cut -- --project <slug>
```

Long steps (`images`, `story`, `render`) commonly exceed the foreground command timeout — run
them with `run_in_background: true` and wait for the completion notification rather than polling.
When two steps don't share a resource (voice generation via Voicebox vs. image generation via
ComfyUI), running them in parallel is safe and saves real time; image generation for the same
project cannot run two batches at once (there's a per-project generation lock), so sequence those.

## Step 5 — QA

Before calling it done:

- [ ] Every generated image actually viewed (by you or a subagent), not just prompt-reviewed.
- [ ] No unwanted people/hands for cast-free channels; correct cast handling for `@lovewilt`.
- [ ] `hyperframes check` passes with 0 errors.
- [ ] Contact-sheet snapshots reviewed across the full timeline, including the closing frame.
- [ ] Measured narration duration is within about 10% of the 3-minute target.
- [ ] The final line's measured safe tail looks like a real ending, not an abrupt cut (Step 2).
- [ ] The rendered MP4's duration, resolution, and audio presence match expectations (the render
      command prints this — read it, don't assume).

## Step 6 — Deliver & report

Report back concisely: what the video is about and for which channel, final duration, where the
MP4 landed (iCloud `ready` folder) and the FCPXML path, and a short account of anything QA caught
and fixed along the way — Jose wants to know what went wrong and was corrected, not just a clean
success story. Don't move the file to `published` yourself; that's Jose's step after he reviews
and uploads it.
