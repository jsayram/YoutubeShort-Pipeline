import fs from "node:fs/promises";

const BASE_URL = "https://api.elevenlabs.io";
export const ELEVENLABS_PROVIDER = "elevenlabs";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_v3";
export const ELEVENLABS_NATURAL_STABILITY = 0.5;

function apiKey() {
  const key = String(process.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured.");
  return key;
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: options.method ?? "GET",
    headers: {
      "xi-api-key": apiKey(),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    const permission = detail.match(/missing the permission ([a-z_]+)/i)?.[1];
    throw new Error(
      permission
        ? `ElevenLabs API key is missing the ${permission} permission.`
        : `ElevenLabs ${options.method ?? "GET"} ${endpoint} failed (${response.status}): ${detail}`,
    );
  }
  return response;
}

export async function listElevenLabsVoices() {
  const voices = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("next_page_token", cursor);
    const response = await request(`/v2/voices?${query}`);
    const page = await response.json();
    for (const voice of page.voices ?? []) {
      voices.push({
        id: voice.voice_id,
        ref: `elevenlabs:${voice.voice_id}`,
        provider: ELEVENLABS_PROVIDER,
        name: voice.name,
        description: voice.description ?? "",
        category: voice.category ?? null,
        labels: voice.labels ?? {},
        previewUrl: voice.preview_url ?? null,
        availableModels: voice.high_quality_base_model_ids ?? [],
      });
    }
    cursor = page.has_more ? page.next_page_token : null;
  } while (cursor);
  return voices;
}

export async function elevenLabsSubscription() {
  const response = await request("/v1/user/subscription");
  const value = await response.json();
  const used = finite(value.character_count);
  const limit = finite(value.character_limit);
  return {
    tier: value.tier ?? null,
    status: value.status ?? null,
    used,
    limit,
    remaining: used === null || limit === null ? null : Math.max(0, limit - used),
    resetAt: value.next_character_count_reset_unix
      ? new Date(value.next_character_count_reset_unix * 1000).toISOString()
      : null,
    overagesAvailable: Boolean(
      value.can_extend_character_limit || value.max_credit_limit_extension === "unlimited" ||
      Number(value.max_credit_limit_extension) > 0
    ),
    overagesAllowedByStudio: false,
  };
}

export function estimateElevenLabsUsage(text) {
  return {
    unit: "characters",
    maximum: [...String(text ?? "")].length,
    exactInputCharacters: [...String(text ?? "")].length,
  };
}

export async function synthesizeElevenLabsLine({
  voiceId,
  text,
  outputFile,
  modelId = ELEVENLABS_DEFAULT_MODEL,
  stability = ELEVENLABS_NATURAL_STABILITY,
  signal,
}) {
  if (!voiceId) throw new Error("Choose an ElevenLabs voice.");
  const response = await request(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal,
      body: {
        text: String(text),
        model_id: modelId,
        voice_settings: { stability },
      },
    },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputFile, bytes);
  return {
    requestId: response.headers.get("request-id") ?? response.headers.get("x-request-id"),
    traceId: response.headers.get("x-trace-id"),
    characterCost: finite(response.headers.get("character-cost")),
    contentType: response.headers.get("content-type"),
  };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
