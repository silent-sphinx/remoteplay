import os from "node:os";
import path from "node:path";

// Every environment variable and tunable default lives here, so this is the one
// file to read to see what RemotePlay can be configured with.

function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function unitInterval(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return value >= 0 && value <= 1 ? value : fallback;
}

// Read on each call so credentials are never captured at import time.
export function getNavidromeConfig() {
  const url = process.env.NAVIDROME_URL?.replace(/\/$/, "");
  const username = process.env.NAVIDROME_USER;
  const password = process.env.NAVIDROME_PASSWORD;
  if (!url || !username || !password) return null;
  return { url, username, password };
}

export const config = {
  subsonic: {
    apiVersion: "1.16.1",
    clientName: "remoteplay",
    streamMaxBitRate: String(positiveInt("REMOTEPLAY_STREAM_MAX_BITRATE", 320)),
  },

  player: {
    // Allows pointing at an mpv binary that isn't on PATH, e.g. a cask's app bundle on macOS.
    mpvBin: process.env.MPV || "mpv",
    defaultVolume: unitInterval("REMOTEPLAY_DEFAULT_VOLUME", 0.8),
    // Standard scrobble threshold: count a play once heard past half the track
    // or 4 minutes, whichever comes first, rather than waiting for full completion.
    scrobbleThresholdSeconds: positiveInt("REMOTEPLAY_SCROBBLE_THRESHOLD_SECONDS", 240),
    // Probing spawns a process, so a miss is retried only this often.
    backendProbeRetryMs: 30_000,
  },

  settings: {
    file: process.env.REMOTEPLAY_SETTINGS_FILE || path.join(process.cwd(), ".remoteplay-settings.json"),
    // Enumerating outputs spawns processes, so the list is held this long.
    outputsTtlMs: 30_000,
  },

  cover: {
    // The service user is only guaranteed read access to the install directory, so the
    // cache prefers systemd's CacheDirectory and falls back to the temp dir.
    cacheDir: process.env.REMOTEPLAY_COVER_CACHE
      || (process.env.CACHE_DIRECTORY ? path.join(process.env.CACHE_DIRECTORY, "covers") : path.join(os.tmpdir(), "remoteplay-covers")),
    // Only the sizes the UI asks for are accepted, so hand-made URLs cannot grow the key space.
    allowedSizes: ["120", "400", "640"],
    // Caps resizes in flight upstream, since a browser can ask for a whole grid at once.
    concurrency: positiveInt("REMOTEPLAY_COVER_CONCURRENCY", 4),
    maxEntries: positiveInt("REMOTEPLAY_COVER_CACHE_ENTRIES", 3000),
    pruneEveryWrites: 200,
    missingTtlMs: 5 * 60_000,
  },
} as const;
