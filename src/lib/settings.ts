import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type AudioOutput = { id: string; name: string };
export type RemotePlaySettings = { audioOutput: string };

const settingsPath = path.join(process.cwd(), ".remoteplay-settings.json");
const defaults: RemotePlaySettings = { audioOutput: "auto" };

export function getSettings(): RemotePlaySettings {
  if (!existsSync(settingsPath)) return defaults;
  try { return { ...defaults, ...JSON.parse(readFileSync(settingsPath, "utf8")) }; } catch { return defaults; }
}

export function saveSettings(settings: Partial<RemotePlaySettings>) {
  const next = { ...getSettings(), ...settings };
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function getMpvOutputs(): AudioOutput[] {
  const help = execFileSync("mpv", ["--no-config", "--audio-device=help"], {
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

export function getAudioOutputs(): AudioOutput[] {
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