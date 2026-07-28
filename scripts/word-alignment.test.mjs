import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAlignedLine,
  collectTranscriptWords,
  fitWordsToLine,
} from "./word-alignment.mjs";

test("collectTranscriptWords accepts the HyperFrames flat transcript", () => {
  assert.deepEqual(
    collectTranscriptWords([
      { text: "Hello", start: 0.2, end: 0.5 },
      { text: "world", start: 0.6, end: 1.1 },
    ]),
    [
      { text: "Hello", start: 0.2, end: 0.5 },
      { text: "world", start: 0.6, end: 1.1 },
    ],
  );
});

test("each line is restored to its measured global speech window", () => {
  const line = {
    clipStart: 7.41,
    clipEnd: 11.57,
    speechStart: 7.742,
    speechEnd: 11.508,
  };
  const words = fitWordsToLine(
    [
      { text: "You", start: 0.12, end: 0.42 },
      { text: "laughed", start: 0.47, end: 1.05 },
      { text: "again", start: 1.2, end: 3.7 },
    ],
    line,
    1,
  );

  assert.equal(words[0].start, 7.742);
  assert.equal(words.at(-1).end, 11.508);
  assert.ok(words.every((word) => word.line === 1));
  assertAlignedLine(words, line, 1);
});
