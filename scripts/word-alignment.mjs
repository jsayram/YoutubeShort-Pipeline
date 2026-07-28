// Pure helpers shared by the caption aligner and its tests.
//
// Speech engines commonly remove long silences from a full-track transcript. The pipeline knows
// the exact speech window for every Voicebox line, so each line is transcribed independently and
// its internal word rhythm is fitted back into that measured window.

export function collectTranscriptWords(transcript) {
  const out = [];
  const push = (word) => {
    const text = String(word.text ?? word.word ?? "").trim();
    const start = Number(word.start ?? word.startTime);
    const end = Number(word.end ?? word.endTime);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    out.push({ text, start, end });
  };

  if (Array.isArray(transcript)) transcript.forEach(push);
  if (Array.isArray(transcript?.words)) transcript.words.forEach(push);
  for (const segment of transcript?.segments ?? transcript?.cues ?? []) {
    (segment.words ?? []).forEach(push);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function fitWordsToLine(words, line, lineIndex) {
  if (!words.length) return [];

  const clipStart = finite(line.clipStart, line.start, 0);
  const clipEnd = finite(
    line.clipEnd,
    line.end,
    clipStart + Math.max(0, Number(line.duration ?? 0)),
  );
  const speechStart = clamp(finite(line.speechStart, clipStart), clipStart, clipEnd);
  const speechEnd = clamp(finite(line.speechEnd, clipEnd), speechStart, clipEnd);
  const sourceStart = words[0].start;
  const sourceEnd = words.at(-1).end;
  const sourceSpan = Math.max(0.001, sourceEnd - sourceStart);
  const targetSpan = Math.max(0.001, speechEnd - speechStart);

  return words.map((word) => ({
    text: word.text,
    start: round(clamp(speechStart + ((word.start - sourceStart) / sourceSpan) * targetSpan, speechStart, speechEnd)),
    end: round(clamp(speechStart + ((word.end - sourceStart) / sourceSpan) * targetSpan, speechStart, speechEnd)),
    line: lineIndex,
  }));
}

export function assertAlignedLine(words, line, lineIndex) {
  if (!words.length) throw new Error(`Caption alignment found no words for line ${lineIndex + 1}.`);
  const speechStart = finite(line.speechStart, line.clipStart, line.start, 0);
  const speechEnd = finite(line.speechEnd, line.clipEnd, line.end, speechStart);
  const tolerance = 0.08;
  const first = words[0];
  const last = words.at(-1);
  if (first.start < speechStart - tolerance || last.end > speechEnd + tolerance) {
    throw new Error(
      `Caption words for line ${lineIndex + 1} fall outside its measured speech window.`,
    );
  }
}

function finite(...values) {
  return values.map(Number).find(Number.isFinite) ?? 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Number(Number(value).toFixed(3));
}
