// Shared HyperFrames caption layer for the automatic composers.
//
// The audio transcriber supplies timing, while narration.timing.json remains authoritative for
// the words. This corrects names and punctuation that speech recognition can mishear without
// giving up word-level highlighting.

export function buildCaptionOverlay({ timing, config, duration, trackIndex }) {
  if (config.captions?.enabled !== true) {
    return {
      enabled: false,
      css: "",
      markup: "",
      script: "",
      trackOffset: 0,
      wordCount: 0,
      chunkCount: 0,
    };
  }

  if (!Array.isArray(timing.words) || !timing.words.length) {
    throw new Error(
      "Captions are enabled but narration.timing.json has no word timings. " +
        "Run: npm run align -- --project <slug>",
    );
  }

  const captionConfig = config.captions ?? {};
  const maxWords = clamp(Number(captionConfig.maxWordsPerGroup ?? 4), 2, 6);
  const words = reconcileWords(timing);
  const chunks = makeChunks(words, maxWords);
  const accent = safeColor(captionConfig.accent, "#f4c75b");
  const inactive = safeColor(captionConfig.color, "#fffaf0");
  const panel = safeColor(captionConfig.panel, "rgba(8, 8, 11, 0.78)", true);
  const bottom = clamp(Number(captionConfig.bottomPx ?? 238), 120, 520);
  const fontSize = clamp(Number(captionConfig.fontSizePx ?? 64), 44, 84);
  const chunkData = JSON.stringify(chunks).replaceAll("<", "\\u003c");

  return {
    enabled: true,
    wordCount: words.length,
    chunkCount: chunks.length,
    trackOffset: 1,
    css: `
      /* Optional active-word captions. The clip owns only the time window; its inner card is
         updated from the registered seekable GSAP timeline. */
      #hf-caption-overlay {
        position: absolute;
        inset: 0;
      }
      #hf-caption-safe {
        position: absolute;
        left: 70px;
        right: 70px;
        bottom: ${bottom}px;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      #hf-caption-card {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: baseline;
        column-gap: 16px;
        row-gap: 7px;
        max-width: 940px;
        min-height: 104px;
        padding: 20px 32px 23px;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 28px;
        background: ${panel};
        box-shadow:
          0 18px 58px rgba(0, 0, 0, 0.46),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
        opacity: 0;
        will-change: transform, opacity;
      }
      .hf-caption-word {
        display: inline-block;
        font-family: "Inter", sans-serif;
        font-size: ${fontSize}px;
        font-weight: 800;
        line-height: 1.04;
        letter-spacing: -0.025em;
        color: ${inactive};
        text-align: center;
        white-space: nowrap;
        -webkit-text-stroke: 2px rgba(8, 8, 11, 0.84);
        paint-order: stroke fill;
        text-shadow:
          0 3px 0 rgba(8, 8, 11, 0.72),
          0 8px 24px rgba(0, 0, 0, 0.58);
        will-change: transform, opacity;
      }
    `,
    markup: `      <div
        id="hf-caption-overlay"
        class="clip"
        data-start="0"
        data-duration="${round(duration)}"
        data-track-index="${trackIndex}"
      >
        <div id="hf-caption-safe">
          <div id="hf-caption-card" aria-label="Animated captions">
            ${Array.from(
              { length: maxWords },
              (_, index) => `<span id="hf-caption-word-${index}" class="hf-caption-word"></span>`,
            ).join("\n            ")}
          </div>
        </div>
      </div>`,
    script: `
      /* Active-word captions. Every visible state is derived from tl.time(), so seeking,
         rendering, and scrubbing backwards all land on the same phrase and highlighted word. */
      const hfCaptionChunks = ${chunkData};
      const hfCaptionCard = document.getElementById("hf-caption-card");
      const hfCaptionSlots = Array.from(document.querySelectorAll(".hf-caption-word"));
      const HF_CAPTION_ACCENT = ${JSON.stringify(accent)};
      const HF_CAPTION_INACTIVE = ${JSON.stringify(inactive)};
      const HF_CAPTION_POP = 0.14;
      const HF_CAPTION_HOLD = 0.18;
      let hfShownChunk = -2;

      function hfCaptionChunkAt(time) {
        let lo = 0;
        let hi = hfCaptionChunks.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (hfCaptionChunks[mid].s <= time) {
            found = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (found < 0 || time > hfCaptionChunks[found].e + HF_CAPTION_HOLD) return -1;
        return found;
      }

      function hfCaptionWordAt(chunk, time) {
        let found = 0;
        for (let index = 0; index < chunk.w.length; index += 1) {
          if (chunk.w[index].s <= time) found = index;
          else break;
        }
        return found;
      }

      tl.fromTo(
        { p: 0 },
        { p: 0 },
        {
          p: 1,
          duration: ${round(duration)},
          ease: "none",
          immediateRender: false,
          onUpdate: () => {
            const time = tl.time();
            const chunkIndex = hfCaptionChunkAt(time);
            if (chunkIndex !== hfShownChunk) {
              hfShownChunk = chunkIndex;
              const chunk = chunkIndex < 0 ? null : hfCaptionChunks[chunkIndex];
              hfCaptionSlots.forEach((slot, index) => {
                slot.textContent = chunk?.w[index]?.t ?? "";
              });
            }

            if (chunkIndex < 0) {
              gsap.set(hfCaptionCard, { opacity: 0, scale: 0.985 });
              return;
            }

            const chunk = hfCaptionChunks[chunkIndex];
            const activeIndex = hfCaptionWordAt(chunk, time);
            const activeWord = chunk.w[activeIndex];
            const progress = Math.max(
              0,
              Math.min(1, (time - activeWord.s) / HF_CAPTION_POP),
            );

            gsap.set(hfCaptionCard, {
              opacity: 1,
              scale: 0.985 + 0.015 * progress,
              transformOrigin: "50% 100%",
            });
            hfCaptionSlots.forEach((slot, index) => {
              const active = index === activeIndex;
              gsap.set(slot, {
                color: active ? HF_CAPTION_ACCENT : HF_CAPTION_INACTIVE,
                opacity: active ? 1 : 0.82,
                scale: active ? 0.94 + 0.1 * progress : 1,
                y: active ? -3 * progress : 0,
                transformOrigin: "50% 82%",
              });
            });
          },
        },
        0,
      );
    `,
  };
}

function reconcileWords(timing) {
  const timedWords = timing.words
    .map((word) => ({
      text: String(word.text ?? "").trim(),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter(
      (word) =>
        word.text &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end >= word.start,
    )
    .sort((a, b) => a.start - b.start);

  const lines = (timing.lines ?? [])
    .map((line, index) => {
      const start = Number(line.speechStart ?? line.start);
      const end = Number(
        line.speechEnd ??
          line.end ??
          (Number.isFinite(start) ? start + Number(line.duration ?? 0) : NaN),
      );
      const sourceWords = String(line.text ?? "").match(/\S+/g) ?? [];
      return { index, start, end, sourceWords, timedWords: [] };
    })
    .filter(
      (line) =>
        line.sourceWords.length && Number.isFinite(line.start) && Number.isFinite(line.end),
    );

  if (!lines.length) {
    return timedWords.map((word) => ({ ...word, line: 0 }));
  }

  // Assign every recognized word to the nearest known narration line. This remains stable with
  // both the old 200 ms story spacing and the current three-second pauses.
  for (const word of timedWords) {
    const midpoint = (word.start + word.end) / 2;
    let nearest = lines[0];
    let nearestDistance = distanceToRange(midpoint, nearest.start, nearest.end);
    for (const line of lines.slice(1)) {
      const distance = distanceToRange(midpoint, line.start, line.end);
      if (distance < nearestDistance) {
        nearest = line;
        nearestDistance = distance;
      }
    }
    nearest.timedWords.push(word);
  }

  return lines.flatMap((line) => {
    const recognized = line.timedWords;
    if (recognized.length === line.sourceWords.length) {
      return line.sourceWords.map((text, index) => ({
        text,
        start: recognized[index].start,
        end: recognized[index].end,
        line: line.index,
      }));
    }

    // Names can merge or split during recognition ("Life Wrapped" becoming "LifeRapt"). Keep
    // the narration's exact spelling and distribute those words across the recognized phrase.
    const start = recognized[0]?.start ?? line.start;
    const end = recognized.at(-1)?.end ?? line.end;
    return distributeWords(line.sourceWords, start, end, line.index);
  });
}

function distributeWords(words, start, end, line) {
  const span = Math.max(0.12, end - start);
  const weights = words.map((word) =>
    Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, "").length) ** 0.62,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = start;

  return words.map((text, index) => {
    const wordStart = cursor;
    cursor += span * (weights[index] / total);
    return {
      text,
      start: round(wordStart),
      end: round(index === words.length - 1 ? end : cursor),
      line,
    };
  });
}

function makeChunks(words, maxWords) {
  const chunks = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    chunks.push({
      s: round(current[0].start),
      e: round(current.at(-1).end),
      w: current.map((word) => ({
        t: word.text,
        s: round(word.start),
        e: round(word.end),
      })),
    });
    current = [];
  };

  for (const word of words) {
    const changedLine = current.length && word.line !== current[0].line;
    const longGap = current.length && word.start - current.at(-1).end > 0.7;
    if (changedLine || longGap || current.length >= maxWords) flush();
    current.push(word);
    if (/[.!?;:]$/.test(word.text)) flush();
  }
  flush();
  return chunks;
}

function distanceToRange(value, start, end) {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function safeColor(value, fallback, allowRgba = false) {
  const text = String(value ?? "").trim();
  const pattern = allowRgba
    ? /^(?:#[0-9a-f]{6}|rgba?\(\s*[\d.\s,%]+\))$/i
    : /^#[0-9a-f]{6}$/i;
  return pattern.test(text) ? text : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Number(Number(value).toFixed(3));
}
