import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  estimateElevenLabsUsage,
  elevenLabsSubscription,
  listElevenLabsVoices,
  synthesizeElevenLabsLine,
} from "./elevenlabs-provider.mjs";

test("ElevenLabs usage is estimated before submission and account balance is normalized", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-only-key";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/user/subscription")) {
      return Response.json({
        tier: "free",
        status: "active",
        character_count: 120,
        character_limit: 1000,
        next_character_count_reset_unix: 2_000_000_000,
      });
    }
    return Response.json({ voices: [], has_more: false });
  };
  try {
    assert.deepEqual(estimateElevenLabsUsage("hello"), {
      unit: "characters",
      maximum: 5,
      exactInputCharacters: 5,
    });
    const subscription = await elevenLabsSubscription();
    assert.equal(subscription.remaining, 880);
    assert.equal(subscription.overagesAllowedByStudio, false);
    assert.deepEqual(await listElevenLabsVoices(), []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  }
});

test("ElevenLabs synthesis records request usage without writing credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "elevenlabs-provider-test-"));
  const output = path.join(directory, "line.mp3");
  process.env.ELEVENLABS_API_KEY = "secret-test-key";
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["xi-api-key"], "secret-test-key");
    return new Response(Buffer.from("audio"), {
      status: 200,
      headers: { "request-id": "request-1", "character-cost": "12" },
    });
  };
  try {
    const result = await synthesizeElevenLabsLine({
      voiceId: "voice-1",
      text: "hello world",
      outputFile: output,
    });
    assert.equal(result.requestId, "request-1");
    assert.equal(result.characterCost, 12);
    assert.equal((await fs.readFile(output)).toString(), "audio");
    assert.doesNotMatch(JSON.stringify(result), /secret-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
