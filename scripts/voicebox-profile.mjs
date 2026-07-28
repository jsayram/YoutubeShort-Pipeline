// Voicebox profile types and engines are not interchangeable. Preset profiles are locked to
// their source engine, while cloned profiles need a cloning engine. Keep that rule in one place
// so Studio, story generation, and the single-shot helper cannot drift apart.

const PRESET_ONLY_ENGINES = new Set(["qwen_custom_voice", "kokoro"]);

export function resolveVoiceboxEngine(profile, requestedEngine) {
  const requested = requestedEngine ? String(requestedEngine) : null;
  const type = profile?.voice_type ?? "cloned";

  if (type === "preset") {
    const locked = profile.preset_engine ?? profile.default_engine ?? requested ?? "qwen";
    return {
      engine: locked,
      changed: Boolean(requested && requested !== locked),
      reason:
        requested && requested !== locked
          ? `preset profile "${profile.name}" is locked to ${locked}`
          : null,
    };
  }

  if (type === "cloned" && (!requested || PRESET_ONLY_ENGINES.has(requested))) {
    return {
      engine: profile.default_engine ?? "qwen",
      changed: Boolean(requested),
      reason: requested
        ? `cloned profile "${profile.name}" cannot use preset-only engine ${requested}`
        : null,
    };
  }

  return {
    engine: profile?.default_engine ?? requested ?? "qwen",
    changed: false,
    reason: null,
  };
}
