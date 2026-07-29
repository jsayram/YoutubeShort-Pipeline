import path from "node:path";
import { commandOutput, loadEnv, readJson, repoRoot } from "./lib.mjs";

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

const templateConfig = await readJson(path.join(repoRoot, "templates", "video.json"));
const provider = templateConfig.imageGen?.provider ?? "comfyui";

if (provider === "comfyui" || provider === "local") {
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
