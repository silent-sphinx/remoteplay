import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type AudioOutput = { id: string; name: string };
export type RemotePlaySettings = { audioOutput: string };

const settingsPath = path.join(process.cwd(), ".remoteplay-settings.json");
const defaults: RemotePlaySettings = { audioOutput: "auto" };

// This process is the only writer, so the file is read once and kept in memory.
let cachedSettings: RemotePlaySettings | null = null;

export function getSettings(): RemotePlaySettings {
  if (cachedSettings) return cachedSettings;
  let settings = defaults;
  if (existsSync(settingsPath)) {
    try { settings = { ...defaults, ...JSON.parse(readFileSync(settingsPath, "utf8")) }; } catch { settings = defaults; }
  }
  cachedSettings = settings;
  return settings;
}

export function saveSettings(settings: Partial<RemotePlaySettings>) {
  const next = { ...getSettings(), ...settings };
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cachedSettings = next;
  return next;
}

// Allows pointing at an mpv binary that isn't on PATH, e.g. a cask's app bundle on macOS.
const MPV_BIN = process.env.MPV || "mpv";

function getMpvOutputs(): AudioOutput[] {
  const help = execFileSync(MPV_BIN, ["--no-config", "--audio-device=help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outputs: AudioOutput[] = [];
  for (const line of help.split("\n")) {
    const match = line.match(/^\s*['\"]([^'\"]+)['\"]\s+\((.+)\)\s*$/);
    if (!match || match[1] === "auto") continue;
    outputs.push({ id: match[1], name: match[2] });
  }
  return outputs;
}

// Enumerating devices spawns mpv (and pactl on Linux), which is far too costly
// for the settings poll, so hold the list briefly between lookups.
const OUTPUTS_TTL_MS = 30_000;
let cachedOutputs: { value: AudioOutput[]; at: number } | null = null;

export function getAudioOutputs(): AudioOutput[] {
  if (cachedOutputs && Date.now() - cachedOutputs.at < OUTPUTS_TTL_MS) return cachedOutputs.value;
  cachedOutputs = { value: readAudioOutputs(), at: Date.now() };
  return cachedOutputs.value;
}

function readAudioOutputs(): AudioOutput[] {
  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      const outputs = getMpvOutputs();
      if (outputs.length) return outputs;
    }
    if (process.platform === "darwin") {
      // macOS system_profiler names are not valid mpv output IDs.
      return [];
    }
    if (process.platform === "linux") {
      return execFileSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((line) => {
        const [, id, name] = line.split(/\s+/);
        return { id: name || id, name: name || id };
      });
    }
  } catch { /* Fall back to the player's default output. */ }
  return [];
}

export function isValidAudioOutput(output: string) {
  if (output === "auto") return true;
  return getAudioOutputs().some((candidate) => candidate.id === output);
}