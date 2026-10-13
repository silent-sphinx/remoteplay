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

export function getAudioOutputs(): AudioOutput[] {
  try {
    if (process.platform === "darwin") {
      const data = JSON.parse(execFileSync("system_profiler", ["SPAudioDataType", "-json"], { encoding: "utf8" }));
      const outputs: AudioOutput[] = [];
      for (const group of data.SPAudioDataType || []) for (const device of group._items || []) outputs.push({ id: device._name, name: device._name });
      return outputs;
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