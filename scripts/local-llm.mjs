const withoutTrailingSlash = (value) => String(value).replace(/\/$/, "");

export function localLlmConfig(overrides = {}) {
  const provider = String(
    overrides.provider ?? process.env.LOCAL_LLM_PROVIDER ?? "lmstudio",
  ).toLowerCase();
  if (provider === "ollama") {
    return {
      provider,
      name: "Ollama",
      baseUrl: withoutTrailingSlash(
        overrides.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      ),
      model: overrides.model ?? process.env.OLLAMA_MODEL ?? "llama3.2",
    };
  }
  return {
    provider: "lmstudio",
    name: "LM Studio",
    baseUrl: withoutTrailingSlash(
      overrides.baseUrl ?? process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234",
    ),
    model: overrides.model ?? process.env.LMSTUDIO_MODEL ?? "qwen/qwen3.5-4b",
  };
}

async function responseError(response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message ?? parsed.error ?? text;
  } catch {
    return text;
  }
}

export async function localLlmStatus(overrides = {}) {
  const config = localLlmConfig(overrides);
  try {
    if (config.provider === "ollama") {
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1800),
      });
      if (!response.ok) return { ...config, reachable: false, modelReady: false, models: [] };
      const body = await response.json();
      const models = (body.models ?? []).map((entry) => entry.name ?? entry.model).filter(Boolean);
      const modelReady = models.some(
        (model) => model === config.model || model.startsWith(`${config.model}:`),
      );
      return { ...config, reachable: true, modelReady, models };
    }

    const response = await fetch(`${config.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) return { ...config, reachable: false, modelReady: false, models: [] };
    const body = await response.json();
    const models = (body.data ?? []).map((entry) => entry.id).filter(Boolean);
    const modelReady = models.some(
      (model) =>
        model === config.model ||
        model.endsWith(`/${config.model}`) ||
        model.includes(config.model),
    );
    return { ...config, reachable: true, modelReady, models };
  } catch {
    return { ...config, reachable: false, modelReady: false, models: [] };
  }
}

export async function localLlmGenerate({
  system,
  prompt,
  model,
  provider,
  temperature = 0.8,
  maxTokens = 256,
} = {}) {
  const config = localLlmConfig({ model, provider });
  if (config.provider === "ollama") {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        system,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }),
    });
    if (!response.ok) {
      throw new Error(`${config.name} returned ${response.status}: ${await responseError(response)}`);
    }
    const data = await response.json();
    return String(data.response ?? "").trim();
  }

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      // Qwen 3.5 otherwise spends the entire short response budget on hidden
      // reasoning and can return an empty scene description.
      reasoning_effort: "none",
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`${config.name} returned ${response.status}: ${await responseError(response)}`);
  }
  const data = await response.json();
  const content = String(data.choices?.[0]?.message?.content ?? "").trim();
  if (!content) {
    throw new Error(
      `${config.name} returned an empty response for model "${config.model}".`,
    );
  }
  return content;
}
