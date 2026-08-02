# @code_details — Content Strategy Research

Research date: end of July 2026. Channel: @code_details, 4 subscribers, coding/tech/AI knowledge
content, clear/confident/informative tone, faceless narrated videos (~3 minutes, no cast) through
this repo's pipeline.

Method: Icahn Method pass via `lite-cge-video-idea-finder`, plus `WebSearch` for current
trending topics and competitive landscape. Honest caveat up front: `WebSearch` cannot pull live
YouTube API data (exact view counts / subscriber counts per video), so the Icahn filter below is
applied using the best available proxies — recurring-topic patterns across many creators and
months (a strong demand signal in its own right), and one industry aggregator
(`faceless.my`, sourced from vidIQ/SocialBlade/HypeAuditor, dated July 2026) that does report real
subscriber and revenue figures for named channels. Where a claim rests on that kind of proxy
rather than a directly verified view/sub pair, it's flagged as such.

## Niche positioning

"Coding, tech, AI, forward-looking knowledge content" is not one niche — it's at least three, each
with different competition and a different entry cost:

- **AI news/reaction** (model releases, lab drama) — the most saturated lane. The AI Grid (~396K
  subs), AI Revolution (~557K), Wes Roth (~330K), and Matt Wolfe (~720K) already own "fast take on
  today's release." A brand-new channel cannot out-publish these on speed, and speed is the only
  edge in this lane.
- **AI tools tutorials** (hands-on workflow content) — Skill Leap AI (~500K), The AI Advantage
  (~380K), All About AI (~240K) own this. Monetizes well via affiliate/sponsorship but rewards
  picking one narrow workflow, not general coverage.
- **Concept/research explainers** (evergreen, not news-cycle-dependent) — Two Minute Papers
  (~1.8M), Fireship (~4.2M, "X in 100 Seconds"), StatQuest, 3Blue1Brown. Higher editorial bar
  (you have to actually understand the concept, not paraphrase an abstract) but the content stays
  watchable for years and doesn't require racing anyone's publish clock.

Given 4 subscribers and no publishing infrastructure to beat a 24-hour news cycle, **the third lane
is where a channel this size can actually win**: evergreen concept explainers, occasionally hooked
to a current event for freshness, never trying to be first on breaking news.

## Content pillars

**1. "Concept in 3 Minutes" — evergreen technical/AI concept explainers (primary pillar).**
The clearest possible explanation of one term or mechanism people already search for
(context window, quantization, RAG, agentic coding, LoRA, vector databases). This is the Fireship
"X in 100 Seconds" format stretched to 3 minutes with more room to actually land the explanation,
and it's proven at both ends of the size spectrum — Fireship at 4.2M subs and smaller channels
(e.g. "Dev Concepts in 60 Seconds"-style formats) both run it. Evergreen means these videos keep
earning views long after upload, unlike news reactions.

**2. "Should You Still Learn/Use X" — confident-stance debates on tools, languages, frameworks.**
"Is [language] dying" is a template multiple channels have run every year since at least 2019
(Edureka, Simplilearn, individual creators, most recently a May 2026 upload) — recurring year over
year across different creators is itself a demand signal, even without exact view numbers per
video. The differentiator for a small channel: take an actual stance backed by real signals
(job postings, package download trends, framework release cadence) instead of a listicle or a
noncommittal "it depends."

**3. "What [Recent Release] Actually Changes for You" — delayed-reaction analysis, not news.**
Publish 3–7 days after a major story breaks, once the first-wave reaction videos have already
been made, and go narrow: what does this change for one specific small audience (a solo developer,
a student, someone building on a phone) rather than general commentary. This sidesteps competing
with AI Grid/Matt Wolfe on speed while still using real current events as a hook. July 2026 has no
shortage of source material: Claude Sonnet 5 pushing agentic coding into everyday workflows,
GitHub Copilot shipping its first open-weight coding model, and the EU's Digital Markets Act ruling
forcing Android open to rival AI assistants (interoperability due July 2027, but the ruling itself
is fresh right now and almost no small creator has covered it from a builder's angle yet).

**4. (Optional, evergreen anxiety topic) "AI and Your Job" — myth-busting, not hype.**
"Will AI replace programmers/developers" is clearly an evergreen, recurring search query — at
least five distinct videos on this exact question surfaced from five different months of 2026
alone (Jan, Feb, Mar, May) across different channels, which is a stronger demand signal than any
single video's view count. The risk is that it's also the most cliché topic in the space; it only
earns a slot if the answer is data-driven and specific rather than another generic hot take. Treat
this as a periodic pillar (maybe 1 in 6–8 videos), not a weekly one.

Recommended split for the first 10–15 videos: roughly 50% pillar 1, 25% pillar 2, 20% pillar 3,
5% pillar 4 — lead with the cheapest-to-get-right, most evergreen format while the channel has no
audience yet to lose.

## Validated video ideas (shortlist of 10)

Each is sized for ~3 minutes, faceless, no cast, and tied to a pillar above.

1. **"What Vibe Coding Actually Means (and What It Doesn't)"** — Pillar 1. "Vibe coding" has had a
   steady stream of explainer uploads from Dec 2025 through May 2026 (beginner guides, 60-second
   explainers, full courses), proving sustained search interest, but most existing videos are
   either full tutorials or hype pieces — there's room for a clean, neutral 3-minute definition.
2. **"Agentic Coding Explained: What Changes When Your AI Can Actually Run the Code"** — Pillar 1 +
   3. Hooks the current (July 2026) shift toward agent-style coding tools in daily workflows;
   explains the underlying concept (agent vs. autocomplete) rather than reviewing a specific tool,
   so it stays evergreen after the news cycle passes.
3. **"Is [a specific mainstream language] Actually Dying in 2026? The Data Says…"** — Pillar 2.
   Reuses a template multiple channels have run annually for years; win by picking one specific,
   currently-debated language and citing real signals instead of a top-10 listicle.
4. **"GitHub's Free Open-Weight Coding Model: What You Can Now Do for $0"** — Pillar 3. Ties to
   GitHub Copilot's first open-weight coding model (July 2026 news); practical, service-journalism
   angle rather than a reaction take.
5. **"Will AI Replace Programmers? The Only Answer Backed by Actual Data"** — Pillar 4. The
   recurring evergreen anxiety query; differentiate by citing concrete numbers (hiring data, task
   completion benchmarks) instead of another opinion video.
6. **"What Is a Context Window, Actually? (Explained With One Picture)"** — Pillar 1. Foundational,
   constantly-searched AI literacy term; ideal for flat-diagram visuals, no screen-content risk.
7. **"RAG vs. Fine-Tuning: Which One Actually Fixes Your AI's Wrong Answers"** — Pillar 1.
   Comparison format with real practical stakes (a common question among people building with AI).
8. **"The EU Just Forced Android Open to Rival AI Assistants — Here's What That Means If You Build
   Apps"** — Pillar 3. Uses the fresh Digital Markets Act ruling as a hook almost no small creator
   will have covered from a developer's build-day perspective yet.
9. **"Why Your AI Coding Assistant Keeps Hallucinating Imports (And the Fix)"** — Pillar 1/2
   hybrid. Narrow, tactical pain-point content with high search intent from people who hit this
   exact problem.
10. **"Quantization Explained: Why a 'Smaller' AI Model Isn't Actually Worse"** — Pillar 1.
    Foundational concept tied to the ongoing local/on-device AI trend; evergreen, diagram-friendly.

## Competitive landscape

Small-to-mid channels worth studying, by format (subscriber figures per `faceless.my`, sourced
from vidIQ/SocialBlade/HypeAuditor, July 2026 — treat as directional, not exact):

| Channel | Approx. subs | Format | Takeaway |
| --- | --- | --- | --- |
| Two Minute Papers | ~1.8M | Research-paper explainer, narration + footage | High editorial bar (must actually read the paper) but the format itself — and its verbal-hook opening — is copyable at any scale. |
| Fireship | ~4.2M | Ultra-fast concept explainer ("X in 100 Seconds"), screen recording + meme animation | Proof that short, dense, opinionated concept explainers outperform generic tutorials; too big to compete with directly but the *format* is the model. |
| Wes Roth | ~330K | Long-form (15–30 min) analysis of AI news, screen recording + commentary | Wins on perspective, not speed — proof that a mid-size channel can skip the "first to publish" race by going deeper instead. |
| The AI Grid | ~396K | Fast-publish AI news, voiceover + screen recording | Wins purely on publish speed; a losing strategy for a 4-subscriber channel with no infrastructure to match it — useful mainly as a "don't compete here" data point. |
| All About AI | ~240K | AI tool tutorials, screen recording + voiceover | Sponsorship-primary revenue model; rewards picking one narrow tool workflow over broad coverage. |
| Future Business Tech | ~140K | AI documentary voiceover | Reported under $1K/month AdSense despite covering AI as a topic — a caution that "AI as topic" alone doesn't guarantee performance; format and specificity matter more than niche choice. |

Format takeaway for @code_details: none of the above are tutorial-heavy in the traditional
"follow along and code this" sense at the small end — the small-to-mid channels that work are
explainer, analysis, or narrow-tool-tutorial formats, all of which map cleanly onto this pipeline's
faceless narrated ~3-minute output.

## Visual style recommendation

**The `flat-vector` default guessed for this channel is very likely the wrong style, and should be
changed before the first video ships.** This isn't a naming coincidence — I read the actual prompt
profile in `templates/prompt.json` (id `flat-vector`, line 57 onward):

> "Nostalgic flat-vector relationship story translated from a rough sunset painting... rough
> brush-shaped geometry, imperfect ink edges, matte screen-printed color blocks... quiet negative
> space, and tender melancholy."

Its negative prompt explicitly excludes "clean corporate vector" and "bright primary palette" —
the exact aesthetic a coding/tech explainer channel would want. Every style in
`templates/image-styles.json` (flat-vector, ink-line, pastel-watercolor-ink, the paper-comic
variants, graingaze-portrait, disposable-camera, etc.) shares the same DNA: warm sunset palettes,
distressed/handmade texture, emotional storybook staging. This library was built for
@lovewilt/@ramirezvilla/@ForkingBites-style narrative and mood content, not technical explainers.
Using it as-is for @code_details would visually brand a coding channel identically to a romance
channel, which undercuts the "clear, confident, informative" tone this channel is supposed to have.

**Recommendation:** build a new style/prompt profile for this channel rather than reusing
`flat-vector` — something closer to a cool-toned, clean geometric/isometric diagram style: flat
shapes, simple icons, abstract representations of technical concepts (a node graph for a neural
network, a glowing box for "black box," a physical key for encryption, a maze for debugging) on a
light or neutral background, no warm-sunset/melancholy palette bias. Two practical notes:

- Stay object/metaphor-led rather than literal-screen-led. This isn't just brand fit — it also
  sidesteps the pipeline's documented local-engine failure modes (screen-content grids rendering
  real human figures, 8-step turbo models failing to render "empty" UI states). Concept metaphors
  (a locked box, a branching path, a stack of blocks) are both more brand-appropriate for this
  channel and safer to generate than literal code-editor or dashboard screenshots.
  Same guidance the SKILL.md failure-modes section already gives for other channels — it applies
  here too.
  Reference: `AGENTS.md` / `SKILL.md` Step 3 for the full list of engine-specific failure modes.
  See `templates/image-styles.json` and `templates/prompt.json` for where to add the new profile.
  This diagram-metaphor style would need its own prompt profile entry (new `id`, e.g.
  `tech-diagram`) rather than reusing the `flat-vector` id, since the id's existing prompt content
  is fully baked toward the romance/mood look.
- If the local SDXL/LoRA stack can't hit a clean flat-diagram look convincingly (worth a quick
  test render before committing), the cloud `gemini` provider path already in
  `templates/image-styles.json` is worth trying for this channel specifically — cloud
  general-purpose image models tend to render clean geometric shapes and (if ever needed) short
  text/labels more reliably than the distilled local checkpoints this pipeline otherwise favors,
  and this channel's cast-free, diagram-first content is exactly the case where that trade-off
  makes sense.

## Bottom line

Don't compete on AI news speed — that lane is owned by channels built for same-day publishing.
Win with evergreen concept explainers (proven at both Fireship's scale and far smaller), occasionally
hooked to a current event once the first wave of reactions has passed. And build a real
tech-diagram visual style for this channel before the first render — the inherited `flat-vector`
default is a romance-content style in disguise, not a diagram-friendly one.

## Update: `tech-diagram` style built and confirmed

Acted on this recommendation: added a `tech-diagram` prompt profile (`templates/prompt.json`) and
paired `flux2-tech-diagram` image style (`templates/image-styles.json`) on the same local FLUX.2
Klein engine `flux2-storybook` uses, cool-toned flat-geometric metaphors instead of the warm
paper-comic look. Test-rendered against two sample lines (`videos/test-tech-diagram/`) — both came
back as clean isometric glass-form metaphors with a single glowing cyan accent, no people, no
readable text, and rendered in ~66s/scene (much faster than the Krea2-family engines). This is now
@code_details' confirmed default in `SKILL.md`, not just a recommendation.
