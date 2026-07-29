import assert from "node:assert/strict";
import test from "node:test";
import { localLlmConfig, localLlmGenerate, localLlmStatus } from "./local-llm.mjs";

test("LM Studio is the default local prompt director", () => {
  const config = localLlmConfig({
    provider: "lmstudio",
    baseUrl: "http://127.0.0.1:1234/",
    model: "test-model",
  });
  assert.deepEqual(config, {
    provider: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234",
    model: "test-model",
  });
});

test("LM Studio generation disables reasoning and returns content", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "A cracked cup waits beside a cold window." } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await localLlmGenerate({
    provider: "lmstudio",
    model: "test-model",
    system: "Direct a scene.",
    prompt: "Loss.",
  });

  assert.equal(result, "A cracked cup waits beside a cold window.");
  assert.equal(requestBody.reasoning_effort, "none");
  assert.equal(requestBody.stream, false);
});

test("LM Studio status reports whether the configured model is available", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ id: "qwen/qwen3.5-4b" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const status = await localLlmStatus({
    provider: "lmstudio",
    model: "qwen/qwen3.5-4b",
  });
  assert.equal(status.reachable, true);
  assert.equal(status.modelReady, true);
});
