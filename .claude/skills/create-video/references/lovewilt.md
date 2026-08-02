# @lovewilt content strategy research

Research pass for the romance/heartbreak channel — niche validation, content pillars, a
validated idea shortlist, competitive landscape, and a call on visual style and voice. Done via
the `lite-cge-video-idea-finder` skill (Icahn Method) plus targeted web research. Channel: 1
subscriber, tone tender/restrained/emotionally honest, never melodramatic.

**A note on method, read before the rest:** this environment's `WebSearch` has no YouTube API
access — it can't pull live view counts or subscriber numbers for specific small channels. So the
Icahn Method pass below (Step 1-2 of the skill) could generate the keyword list and describe the
filter, but couldn't score real live candidates against it the way the skill is designed to run.
What follows instead is genre-level demand evidence: known channel case studies, industry RPM/growth
data for this content category, and creator-community consensus on what performs. It's real signal,
but it's not the same as five specific 200K-view/20K-sub videos with links. **Before greenlighting a
full pillar, Jose should spend 15 minutes running the actual manual Icahn pass himself** (YouTube
search → Filters → Videos, hunt for 100K+ views / under-100K subs / 5:1+ ratio / mediocre packaging)
on the keyword list at the end of this doc, since that step needs live YouTube search access this
session didn't have.

## Niche positioning

The proven, at-scale version of "relationship stories on YouTube" is louder and more conflict-driven
than what lovewilt is going for. Industry trend data (OutlierKit, FluxNote — both YouTube-growth
research/tooling sites, cross-checked against known channels) tracks two adjacent categories:

- **"Relationship / Drama Stories"** (AITA-style dilemmas, confessions, family conflict) — a
  recognized Tier 2 monetizable niche, $4-7 RPM, works in both Shorts and 10-20 min long-form.
- **"Betrayal & Revenge Storytelling"** — flagged as one of the fastest-growing sub-niches
  tracked right now (cited at 21x year-over-year growth, $20-25 CPM), explicitly noted as working
  well for faceless channels using AI voiceover over curated/cinematic visuals, sourced from
  Reddit stories or viewer submissions.

That's real proof the *format* (faceless, narrated, single-story-per-video, AI or AI-adjacent
voice, curated visuals) has a hungry audience. But the content riding that growth is almost all
conflict/drama/vindication — cheating reveals, "here's what I said back," petty-revenge
satisfaction. That's the opposite of lovewilt's brief. There's very little at-scale content sitting
in the quiet register lovewilt actually wants: aftermath instead of confrontation, restraint
instead of vindication, an ordinary Tuesday instead of a dramatic reveal. That gap — tender,
non-dramatic, emotionally honest relationship and grief content — is the actual opportunity, not a
copy of the loudest format in the space.

The closest working analog for *tone* (not subject) is the "quotes / healing" cinematic-shorts
genre: calm, deliberate delivery (multiple sources independently point to a measured pace roughly
15-20% slower than normal conversational speech) over cinematic visuals, built for people using the
video to sit with a feeling rather than be shocked by one. That pacing and restraint is the right
model to borrow, even though lovewilt's format (a single continuous ~3-minute narrated story, not a
quote-plus-visual loop) is structurally different.

## Content pillars

Six recurring emotional throughlines, each mapped to what's already built into
`templates/topics/romance.json` (its `sentimentRules`, `storyBeats`, and `sceneDirectionRules`
already anticipate most of these — new videos in these pillars should render well with light or no
extra prompt engineering):

1. **The Empty Chair** — grief and absence, both parent-loss and partner-loss. Object/solo cast
   mode, absence implied through a chair, a second cup, a long shadow. Maps to the pack's
   `grief, distance, and aching absence` sentiment rule and the object-implied-partner cast mode.
2. **Missed Calls, Unanswered Texts** — the specific modern loneliness of a phone that used to mean
   something and now doesn't. Maps directly to several `sceneDirectionRules` already built for
   phone/notification beats ("stopped asking... made it home," "entire days," "seemed distant").
3. **The Ones Who Stayed vs. The Ones Who Left** — the turning-point/choice pillar. One video's
   throughline is a departure (suitcase, doorway, opposite directions); its companion video is the
   deliberate-stay counterpart ("every single day, I choose to stay"). Pairing these two as a
   recurring diptych format gives the channel a signature structure.
4. **Quiet Reconciliation** — hurt softening into repair, not through a grand gesture but a
   tentative touch after distance. Maps to the pack's argument/forgiveness sentiment rule.
5. **Ordinary Joy** — laughing mid-sentence, staying up too late talking, a coffee order remembered
   without asking. This pillar matters structurally, not just tonally: it's the release valve that
   keeps the channel from reading as a grief channel that happens to make videos, which would drift
   toward the melodrama the brief explicitly rejects.
6. **Letters Never Sent** — direct-address reflection, handling a keepsake or photograph, addressed
   to someone specific (an ex, a late parent, a version of themselves). This is the pillar closest
   to the "letter to my ex" format that shows up repeatedly in relationship-content research, and
   it's the one where lovewilt's restrained, tender voice has the clearest edge over louder
   competitors.

## Validated video ideas

Ten concrete titles, each assigned to a pillar and matched to an existing `sceneDirectionRules`
entry in the romance pack (so the visual direction is largely pre-built):

1. **"The Empty Chair at Sunday Dinner"** — Empty Chair (parent grief) · object/solo, still-life absence.
2. **"I Still Set Two Cups Down"** — Empty Chair (partner grief) · morning ritual, second cup.
3. **"The Voicemail I Can't Delete"** — Empty Chair / Missed Calls crossover · phone-as-keepsake, matches the `playlist`/`saved on my phone` rule almost exactly.
4. **"Why I Stopped Asking If You Made It Home"** — Missed Calls · matches the "stopped asking... made it home" rule directly.
5. **"The Text I Never Sent Back"** — Missed Calls · silent-phone, hours-into-days rule.
6. **"The Ones Who Left Didn't Have to Say Goodbye"** — Stayed vs. Left (departure) · suitcase/doorway rule.
7. **"Every Single Day, I Choose to Stay"** — Stayed vs. Left (commitment) · matches the "choose to stay" rule, paired release with #6.
8. **"The Fight We Almost Didn't Come Back From"** — Quiet Reconciliation · argument-to-touch rule.
9. **"The Coffee Order He Still Remembers"** — Ordinary Joy · coffee/recognition rule, a lighter/warmer entry.
10. **"She Still Laughs Like That, Just Not With Me"** — Letters Never Sent (memory, bittersweet) · photograph/memory rule, direct-address reflection.

Recommend opening the channel with #9 or #7 (the two warmest entries) rather than the heaviest
grief pieces — establishes the channel's restrained, non-melodramatic register before it earns the
trust to go quieter and sadder.

## Competitive landscape

What actually surfaced in research (with the caveat above about live-data limits):

- **Actually Happened** (TheSoul Publishing) — animated Reddit-story channel, peaked at 3.18M
  subscribers before its catalog was mass-privated with no explanation. Proof the appetite for
  narrated relationship/life-drama stories is enormous — but it's animated, dramatized, often
  embellished, and got shut down in a way that's a live cautionary tale about sourcing/authenticity
  risk in this genre.
- **Story Time Animated** — animated relationship/life-story channel, ~10-minute videos, 3x/week
  upload cadence, still active. Shows the format supports a sustained long-form (not just Shorts)
  cadence.
- **Two Hot Takes / Smosh Reads Reddit Stories** — hosted (on-camera) reaction-to-Reddit-relationship-story
  format. Bigger creators, proves audience demand for the underlying stories even when the
  presentation is a live reaction rather than pure narration.
- **Ling and Lamb** — 1.5M subscribers, 500M+ views, real couple doing relationship/marriage
  storytime vlogs. On-camera, not faceless, and format is closer to lifestyle vlog than narrated
  story — useful mainly as evidence that "relationship content" as a broad category has a large
  built-in audience, not as a direct format comparable to lovewilt.
- **Genre-wide pattern, not one channel**: the quotes/healing cinematic-shorts format (calm,
  measured voiceover, cinematic AI or curated visuals, no host) is the closest tonal match to
  lovewilt and is repeatedly cited as a low-production, high-retention pattern — but it's typically
  quote-based and looped, not a single continuous narrative, so lovewilt's ~3-minute narrated-story
  structure is a genuine differentiation within that pattern rather than a copy of it.

The gap this points to: nearly all proven at-scale supply in "relationship stories" is either
dramatized/conflict-driven (Actually Happened, AITA/betrayal formats) or presenter-led (Ling &
Lamb, relationship coaches). Very little occupies the quiet, non-dramatic, emotionally-honest
register lovewilt is aiming for. That's the opening — not a weakness in the plan.

## Visual style recommendation

**Confirm `graingaze-portrait`.** Reasoning: the romance topic pack already commits hard to
silhouette/profile staging, guarded posture, and implied-rather-than-shown partners rather than
straight portraiture — a cinematic analog-portrait LoRA with tactile grain and soft diffused light
is the right register for that (quiet, filmic, a little worn) and avoids two wrong directions this
research surfaced:

- The dramatized/animated look of the big drama-story channels (Actually Happened, Story Time
  Animated) would read as cartoonish and undercut the "never melodramatic" brief.
- `disposable-camera`'s harsh-flash, candid-snapshot look (right for @ramirezvilla's unpolished
  tone) reads too raw and too casual for grief/reconciliation beats that need to feel composed and
  held, not snapped.

One thing to flag, not a blocker: the LoRA's creator recommends 3:4 or 1:1 framing for best
results, while this pipeline standardizes on the wider 1920x1080 output for consistency across
channels. That's a known tradeoff already documented in `templates/image-styles.json` — worth a
one-off test crop comparison if a future QA pass flags portrait compositions feeling
cropped-too-wide, but not worth breaking pipeline consistency over pre-emptively.

## Voice recommendation

**Default to `MyOwn` (Jose's own cloned voice) as the channel's primary voice. Pilot `raspy sad` as
a deliberate A/B variant on the Empty Chair (grief) pillar specifically, not as a blanket
replacement.**

Reasoning:

- The explicit brief is "tender, restrained, emotionally honest — never melodramatic." A voice
  performing sadness (a rasp, a huskiness added on top of the read) risks sounding like grief in
  costume rather than a person quietly stating what happened — exactly the melodrama the brief
  rules out. A plainer, calmer voice doesn't have to work to convince the listener it's sad; the
  words and the pacing do that job, which is a more restrained and ultimately more credible choice.
- The genre research independently supports this: the pattern identified for the tonally-closest
  format (quotes/healing cinematic shorts) is calm, deliberate, measured delivery, not a
  dramatically inflected one. Separately, creator-community consensus flagged in research is that
  a real, authentic-sounding voice consistently outperforms an obviously performed or synthetic
  one in exactly this kind of reflective, healing-adjacent content — favoring whichever profile
  reads as least "performed," which points toward the plainer option by default.
- A single default voice also gives the channel range: `MyOwn` can carry the lighter pillars
  (Ordinary Joy, Quiet Reconciliation) as naturally as the heavier ones, without needing a voice
  switch between videos that would make the channel feel inconsistent.
- That said, grief-for-a-parent specifically is the heaviest, highest-stakes pillar, and a slight
  vocal wear (not performed sadness, just a voice that sounds like it's been through something) is
  a legitimate, non-melodramatic choice for that register specifically. Rather than guess, treat it
  as a two-video test: run one Empty Chair video in `MyOwn` and a comparable one in `raspy sad`,
  hold everything else constant (same pillar, similar length, similar visual density), and let
  retention and comments — not a prediction made here — settle whether the heavier register earns
  its place for that one pillar. Don't extend `raspy sad` to the Ordinary Joy or Quiet
  Reconciliation pillars under any outcome; a rasp reads wrong against laughter and repair.

## Keywords for Jose's own manual Icahn pass

Run these through YouTube search (Filters → Videos, then hunt for 100K+ views / under-100K
subscribers / 5:1+ views-to-subs ratio / mediocre packaging) since this session's `WebSearch` has
no live YouTube data access:

- "letter to my ex"
- "empty chair grief"
- "missing my mom video"
- "the text I never sent"
- "reasons I stayed" / "why I stayed" quotes
- "healing after losing my dad"
- "letter to my late mother"
- "the ones who stayed"
