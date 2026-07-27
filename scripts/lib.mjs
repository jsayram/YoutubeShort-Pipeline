import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];
  const booleanFlags = new Set([
    "approved",
    "dry-run",
    "fit",
    "force",
    "personality",
    "resume",
    "skip-images",
    "skip-voice",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue;
    } else if (booleanFlags.has(rawKey)) {
      flags[rawKey] = true;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[rawKey] = argv[index + 1];
      index += 1;
    } else {
      flags[rawKey] = true;
    }
  }

  return { flags, positionals };
}

export async function loadEnv() {
  const envPath = path.join(repoRoot, ".env");
  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function assertSlug(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Use a lowercase project slug containing only letters, numbers, and hyphens.");
  }
  return slug;
}

export function videoDir(slug) {
  const safeSlug = assertSlug(slug);
  return path.join(repoRoot, "videos", safeSlug);
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? "inherit",
      env: { ...process.env, ...options.env },
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function commandOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
