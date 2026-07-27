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

if (process.env.GEMINI_API_KEY) console.log("✓ GEMINI_API_KEY is configured");
else failures.push("GEMINI_API_KEY is missing from .env.");

const baseUrl = (process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493").replace(/\/$/, "");
const health = await fetch(`${baseUrl}/health`).catch(() => null);
if (health?.ok) {
  const status = await health.json().catch(() => ({}));
  console.log(`✓ Voicebox at ${baseUrl} (model ${status.model_size ?? "unknown"})`);

  const templateConfig = await readJson(path.join(repoRoot, "templates", "video.json"));
  const defaultProfile = templateConfig.voicebox.profile;
  const profiles = await fetch(`${baseUrl}/profiles`)
    .then((response) => response.json())
    .catch(() => []);
  if (profiles.some((profile) => profile.name === defaultProfile)) {
    console.log(`✓ Voicebox profile "${defaultProfile}"`);
  } else {
    failures.push(
      `Voicebox profile "${defaultProfile}" is missing. Found: ${profiles.map((p) => p.name).join(", ") || "none"}.`,
    );
  }
} else {
  failures.push(`Voicebox is not reachable at ${baseUrl}. Start the application.`);
}

if (failures.length) {
  console.error("\nSetup needs attention:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

