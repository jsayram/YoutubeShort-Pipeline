import fs from "node:fs/promises";
import path from "node:path";
import { commandOutput, loadEnv, readJson, repoRoot } from "./lib.mjs";
import { localLlmStatus } from "./local-llm.mjs";

await loadEnv();
const failures = [];

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) failures.push(`Node 22+ required; found ${process.versions.node}.`);
else console.log(`✓ Node ${process.versions.node}`);

for (const command of ["ffmpeg", "ffprobe"]) {
  try {
    await commandOutput(command, ["-version"]);
    console.log(`✓ ${command}`);
  } catch {
    failures.push(`${command} is not available.`);
  }
}

// The local prompt director is optional. If it is unavailable, image generation safely uses the
// provider's normal prompts, so Doctor reports the condition without blocking the pipeline.
const localLlm = await localLlmStatus();
if (localLlm.reachable && localLlm.modelReady) {
  console.log(`✓ ${localLlm.name} at ${localLlm.baseUrl} (model ${localLlm.model})`);
} else {
  console.log(
    `⚠ ${localLlm.name} prompt enrichment is unavailable at ${localLlm.baseUrl} ` +
      `(optional; expected model ${localLlm.model})`,
  );
}

const templateConfig = await readJson(path.join(repoRoot, "templates", "video.json"));
const provider = templateConfig.imageGen?.provider ?? "comfyui";
const finalCutBridge = path.resolve(
  process.env.FINAL_CUT_BRIDGE_DIR ?? path.join(repoRoot, "..", "final-cut-youtube-bridge"),
);
const finalCutCli = path.join(finalCutBridge, "src", "cli.mjs");
const finalCutReady = await fs.access(finalCutCli).then(() => true, () => false);
if (finalCutReady) console.log(`✓ Final Cut bridge at ${finalCutBridge}`);
else {
  failures.push(
    `Final Cut bridge is missing at ${finalCutBridge}. ` +
      "Set FINAL_CUT_BRIDGE_DIR in .env if it was moved.",
  );
}

if (provider === "drawthings" || provider === "draw-things") {
  const drawThingsUrl = (
    process.env.DRAWTHINGS_BASE_URL ?? "http://127.0.0.1:7860"
  ).replace(/\/$/, "");
  const sharedSecret = process.env.DRAWTHINGS_SHARED_SECRET;
  const response = await fetch(drawThingsUrl, {
    headers: sharedSecret ? { Authorization: `Bearer ${sharedSecret}` } : {},
  }).catch(() => null);
  if (!response?.ok) {
    failures.push(
      `Draw Things is not reachable at ${drawThingsUrl}. Open Draw Things and enable its HTTP API server.`,
    );
  } else {
    const status = await response.json().catch(() => ({}));
    console.log(`✓ Draw Things at ${drawThingsUrl}`);
    const wantedModel = templateConfig.imageGen.drawThingsModel;
    if (status.model === wantedModel) console.log(`✓ Draw Things model "${wantedModel}"`);
    else {
      failures.push(
        `Draw Things has "${status.model ?? "no model"}" selected; choose "${wantedModel}".`,
      );
    }
    const wantedLoras = templateConfig.imageGen.loras ?? [];
    const activeLoras = Array.isArray(status.loras) ? status.loras : [];
    for (const wanted of wantedLoras) {
      const active = activeLoras.find((entry) => entry.file === wanted.file);
      if (active) {
        const currentWeight = Number(active.weight);
        const note =
          currentWeight === Number(wanted.weight)
            ? ""
            : ` (UI is ${currentWeight}; the pipeline overrides it per request)`;
        console.log(`✓ Draw Things LoRA "${wanted.file}" at pipeline weight ${wanted.weight}${note}`);
      } else {
        failures.push(
          `Draw Things must have LoRA "${wanted.file}" available; ` +
            `active: ${activeLoras.map((entry) => entry.file).join(", ") || "none"}.`,
        );
      }
    }
  }
} else if (provider === "comfyui" || provider === "local") {
  const comfyUrl = (process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
  const stats = await fetch(`${comfyUrl}/system_stats`).catch(() => null);
  if (stats?.ok) {
    const info = await stats.json().catch(() => ({}));
    console.log(`✓ ComfyUI at ${comfyUrl} (v${info.system?.comfyui_version ?? "unknown"})`);

    const wanted = templateConfig.imageGen.checkpoint;
    const seen = await fetch(`${comfyUrl}/object_info/CheckpointLoaderSimple`)
      .then((response) => response.json())
      .then((info) => info.CheckpointLoaderSimple.input.required.ckpt_name[0])
      .catch(() => []);
    if (seen.includes(wanted)) console.log(`✓ Checkpoint "${wanted}"`);
    else {
      failures.push(
        `ComfyUI cannot see checkpoint "${wanted}". Found: ${seen.join(", ") || "none"}. ` +
          "Check ~/ComfyUI/extra_model_paths.yaml.",
      );
    }
  } else {
    failures.push(
      `ComfyUI is not reachable at ${comfyUrl}. Start it with: ` +
        "cd ~/ComfyUI && venv/bin/python main.py --listen 127.0.0.1 --port 8188",
    );
  }
} else if (process.env.GEMINI_API_KEY) {
  console.log("✓ GEMINI_API_KEY is configured");
} else {
  failures.push("GEMINI_API_KEY is missing from .env.");
}

const baseUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
const voiceboxAppRunning = await commandOutput("pgrep", ["-x", "voicebox"]).then(
  (output) => Boolean(output.trim()),
  () => false,
);
const voiceboxDeadline = Date.now() + (voiceboxAppRunning ? 45000 : 1);
let voicebox = null;
let stableChecks = 0;
do {
  const [healthResponse, profilesResponse] = await Promise.all([
    fetch(`${baseUrl}/health`).catch(() => null),
    fetch(`${baseUrl}/profiles`).catch(() => null),
  ]);
  if (healthResponse?.ok && profilesResponse?.ok) {
    const [status, profiles] = await Promise.all([
      healthResponse.json().catch(() => ({})),
      profilesResponse.json().catch(() => null),
    ]);
    if (status.status === "healthy" && Array.isArray(profiles)) {
      stableChecks += 1;
      voicebox = { status, profiles };
      if (stableChecks >= 2) break;
    } else {
      stableChecks = 0;
    }
  } else {
    stableChecks = 0;
  }
  if (Date.now() < voiceboxDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} while (Date.now() < voiceboxDeadline);

if (voicebox && stableChecks >= 2) {
  const { status, profiles } = voicebox;
  console.log(`✓ Voicebox at ${baseUrl} (model ${status.model_size ?? "unknown"})`);

  const defaultProfile = templateConfig.voicebox.profile;
  if (profiles.some((profile) => profile.name === defaultProfile)) {
    console.log(`✓ Voicebox profile "${defaultProfile}"`);
  } else {
    failures.push(
      `Voicebox profile "${defaultProfile}" is missing. Found: ${profiles.map((p) => p.name).join(", ") || "none"}.`,
    );
  }
} else {
  failures.push(
    voiceboxAppRunning
      ? `Voicebox is open but its server did not become stable at ${baseUrl}. Restart the application.`
      : `Voicebox is not reachable at ${baseUrl}. Start the application.`,
  );
}

if (failures.length) {
  console.error("\nSetup needs attention:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
