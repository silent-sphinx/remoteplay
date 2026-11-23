import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { rmSync } from "node:fs";
import { config } from "@/lib/config";
import { subsonicUrl, scrobble } from "@/lib/subsonic";
import { getSettings, isValidAudioOutput } from "@/lib/settings";

export type ServerSong = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string;
};
type PlayerBackend = "mpv";

type PlayerState = {
  current: ServerSong | null;
  playing: boolean;
  position: number;
  volume: number;
  startedAt: number | null;
  pausedAt: number;
  error: string | null;
};

type PlayerRuntime = {
  state: PlayerState;
  processRef: ChildProcess | null;
  activeChildId: number;
  backend: PlayerBackend | null;
  mpvIpcPath: string | null;
  mpvEventSocket: net.Socket | null;
  ended: { seq: number; songId: string; at: number } | null;
  claimedEndSeq: number;
  playlist: ServerSong[];
  playlistIndex: number;
  scrobbledCurrent: boolean;
};

const globalRuntime = globalThis as typeof globalThis & {
  __remoteplayPlayer?: PlayerRuntime;
};

let childCounter = 0;

// mpv applies a cubic curve to its volume property (gain = (vol/100)^3), so a
// 1:1 mapping is silent at low slider values. Square the slider so amplitude
// follows a quadratic taper, since loudness is perceived logarithmically.
// Squaring alone leaves everything under ~13% inaudible, so any non-zero slider
// value is lifted onto a gain floor; only 0 is true silence.
const MIN_AUDIBLE_GAIN = config.player.minVolumeGain;

function volumeToMpv(linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  if (clamped === 0) return 0;
  const gain = MIN_AUDIBLE_GAIN + (1 - MIN_AUDIBLE_GAIN) * clamped ** 2;
  return Math.round(gain ** (1 / 3) * 100);
}

function mpvToVolume(percent: number): number {
  const gain = (Math.max(0, Math.min(100, percent)) / 100) ** 3;
  if (gain <= MIN_AUDIBLE_GAIN) return 0;
  return Math.sqrt((gain - MIN_AUDIBLE_GAIN) / (1 - MIN_AUDIBLE_GAIN));
}

const runtime = (globalRuntime.__remoteplayPlayer ??= {
  state: {
    current: null,
    playing: false,
    position: 0,
    volume: config.player.defaultVolume,
    startedAt: null,
    pausedAt: 0,
    error: null,
  },
  processRef: null,
  activeChildId: 0,
  backend: null,
  mpvIpcPath: null,
  mpvEventSocket: null,
  ended: null,
  claimedEndSeq: 0,
  playlist: [],
  playlistIndex: 0,
  scrobbledCurrent: false,
});
const state = runtime.state;

process.once("SIGTERM", () => {
  stopProcess();
  process.exit(0);
});
process.once("SIGINT", () => {
  stopProcess();
  process.exit(0);
});

// Probing spawns a process, and player state is polled once a second per client,
// so cache the result. A hit is kept for the process lifetime; a miss is retried
// so installing mpv is picked up without a restart.
let backendProbe: { value: PlayerBackend | null; at: number } | null = null;

function probeBackend(): PlayerBackend | null {
  if (backendProbe && (backendProbe.value || Date.now() - backendProbe.at < config.player.backendProbeRetryMs)) {
    return backendProbe.value;
  }
  let value: PlayerBackend | null = null;
  try {
    execFileSync(config.player.mpvBin, ["--version"], { stdio: "ignore" });
    value = "mpv";
  } catch {
    /* Leave the backend unresolved and retry on the next probe. */
  }
  backendProbe = { value, at: Date.now() };
  return value;
}

function findBackend(): PlayerBackend {
  const backend = probeBackend();
  if (!backend) throw new Error("No server audio player found. Install mpv on the server, or set MPV to its path.");
  return backend;
}

function elapsedPosition() {
  const position = state.position;
  const duration = state.current?.duration;
  return duration && duration > 0 ? Math.min(position, duration) : position;
}

function stopProcess() {
  const currentChild = runtime.processRef;
  if (currentChild) {
    runtime.processRef = null;
    // Detach all listeners so dead processes cannot corrupt future track state
    currentChild.removeAllListeners();
    if (!currentChild.killed) {
      try {
        currentChild.kill("SIGTERM");
      } catch {
        /* Ignore if already terminated */
      }
    }
  }
  if (runtime.mpvIpcPath) {
    runtime.mpvEventSocket?.destroy();
    runtime.mpvEventSocket = null;
    rmSync(runtime.mpvIpcPath, { force: true });
    runtime.mpvIpcPath = null;
  }
}

function sendMpvCommand(command: Record<string, unknown>, attempt = 0) {
  sendMpvCommands([command], attempt);
}

function sendMpvCommands(commands: Record<string, unknown>[], attempt = 0) {
  const ipcPath = runtime.mpvIpcPath;
  if (!ipcPath) return;
  const socket = net.createConnection(ipcPath);
  socket.once("error", (error: NodeJS.ErrnoException) => {
    socket.destroy();
    if (
      attempt < 20 &&
      runtime.mpvIpcPath === ipcPath &&
      (error.code === "ENOENT" || error.code === "ECONNREFUSED")
    ) {
      setTimeout(() => sendMpvCommands(commands, attempt + 1), 50);
    }
  });
  socket.once("connect", () => {
    socket.end(`${commands.map((command) => JSON.stringify(command)).join("\n")}\n`);
  });
}

function observeMpvProperties(ipcPath: string) {
  if (runtime.mpvEventSocket || runtime.mpvIpcPath !== ipcPath) return;

  const socket = net.createConnection(ipcPath);
  runtime.mpvEventSocket = socket;
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (data: string) => {
    buffer += data;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleMpvEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Ignore incomplete or non-JSON IPC output.
      }
    }
  });
  socket.on("error", () => {
    socket.destroy();
  });
  socket.once("connect", () => {
    socket.write([
      ["observe_property", 1, "time-pos"],
      ["observe_property", 2, "duration"],
      ["observe_property", 3, "volume"],
      ["observe_property", 4, "pause"],
    ].map((command) => JSON.stringify({ command }) ).join("\n") + "\n");
  });
  socket.on("close", () => {
    if (runtime.mpvEventSocket !== socket) return;
    runtime.mpvEventSocket = null;
    if (runtime.mpvIpcPath === ipcPath) {
      setTimeout(() => observeMpvProperties(ipcPath), 50);
    }
  });
}

export function getPlayerState() {
  return {
    current: state.current,
    playing: state.playing,
    position: elapsedPosition(),
    volume: state.volume,
    error: state.error,
    available: Boolean(runtime.processRef) || canPlay(),
    queue: runtime.playlist.slice(runtime.playlistIndex + 1),
    ended: runtime.ended && {
      seq: runtime.ended.seq,
      songId: runtime.ended.songId,
      ago: Date.now() - runtime.ended.at,
    },
  };
}

export function canPlay() {
  return probeBackend() !== null;
}

export function getBackend(): PlayerBackend | null {
  return probeBackend();
}

export function getAudioControlCapabilities() {
  const backend = probeBackend();
  return {
    volume: backend === "mpv",
    outputSelection: backend === "mpv",
  };
}

export function play(song: ServerSong, upcoming: ServerSong[] = [], startOffset = 0, afterEnd?: number) {
  const url = subsonicUrl("stream", { id: song.id });
  if (!url) throw new Error("Navidrome is not configured");

  // Auto-advance is accepted once per natural track end, from whichever client asks first
  if (afterEnd !== undefined) {
    if (afterEnd !== runtime.ended?.seq || afterEnd === runtime.claimedEndSeq) return;
    runtime.claimedEndSeq = afterEnd;
  }

  findBackend();

  // Mirror the rest of the queue into mpv's own playlist so the host keeps
  // advancing through it on its own, instead of depending on a client's poll loop.
  runtime.playlist = [song, ...upcoming];
  runtime.playlistIndex = 0;
  const loadCommands = [
    { command: ["loadfile", url, "replace"] },
    ...upcoming.map((next) => {
      const nextUrl = subsonicUrl("stream", { id: next.id });
      return { command: ["loadfile", nextUrl, "append"] };
    }),
  ];

  if (runtime.processRef && runtime.backend === "mpv" && runtime.mpvIpcPath) {
    sendMpvCommands([
      ...loadCommands,
      { command: ["set_property", "pause", false] },
    ]);
    setTrackState(song, startOffset);
    return;
  }

  stopProcess();
  runtime.backend = "mpv";

  const currentChildId = ++childCounter;
  runtime.activeChildId = currentChildId;

  const configuredOutput = getSettings().audioOutput;
  const output = isValidAudioOutput(configuredOutput)
    ? configuredOutput
    : "auto";
  const volInt = volumeToMpv(state.volume);

  const mpvIpcPath = `/tmp/remoteplay-mpv-${process.pid}.sock`;
  rmSync(mpvIpcPath, { force: true });
  runtime.mpvIpcPath = mpvIpcPath;
  const child = spawn(config.player.mpvBin, [
    "--no-video",
    "--really-quiet",
    "--force-window=no",
    "--idle=yes",
    `--input-ipc-server=${mpvIpcPath}`,
    `--volume=${volInt}`,
    `--replaygain=${config.player.loudnessNormalization ? "no" : config.player.replayGain}`,
    ...(config.player.loudnessNormalization ? ["--af=loudnorm=I=-16:LRA=11:TP=-1.5"] : ["--replaygain-clip"]),
    "--network-timeout=15",
    ...(output !== "auto" ? [`--audio-device=${output}`] : []),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  runtime.processRef = child;
  state.error = null;

  // Keep the tail of stderr so an abnormal exit can report the real cause
  let stderrTail = "";

  child.stdout?.setEncoding("utf8");
  let stdoutBuffer = "";
  child.stdout?.on("data", (data: string) => {
    stdoutBuffer += data;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleMpvEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Ignore incomplete or non-JSON output from mpv.
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (runtime.activeChildId !== currentChildId || runtime.processRef !== child) return;
    const message = data.toString().replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim();
    if (!message) return;
    stderrTail = `${stderrTail}\n${message}`.slice(-500).trim();
    // Capture genuine fatal streaming errors immediately; ignore non-fatal seek/stream warnings
    if (/Server returned [45]\d\d|Connection refused|Protocol not found|Failed to resolve|No such file or directory|No such audio|Could not open|Device or resource busy|cannot open/i.test(message)) {
      state.error = message;
    }
  });

  child.once("error", (error) => {
    if (runtime.activeChildId !== currentChildId || runtime.processRef !== child) return;
    // spawn itself failed (e.g. backend binary missing)
    state.error = `Could not start mpv: ${error.message}`;
    state.playing = false;
    runtime.processRef = null;
  });

  child.once("exit", (code, signal) => {
    // Guard against race conditions when a new track has already superseded this child
    if (runtime.activeChildId !== currentChildId || runtime.processRef !== child) return;
    runtime.processRef = null;

    const stopped = signal === "SIGTERM" || signal === "SIGINT" || code === 123 || code === 130 || code === 143;

    if (!state.error && !stopped) {
      if (code !== 0) {
        // Abnormal exit code: surface the backend's own stderr when we have it
        state.error = stderrTail || `mpv exited unexpectedly (code ${code}).`;
      }
    }

    state.current = null;
    state.playing = false;
    state.position = 0;
    state.pausedAt = 0;
    state.startedAt = null;
  });

  runtime.backend = "mpv";
  setTrackState(song, startOffset);
  observeMpvProperties(mpvIpcPath);
  sendMpvCommands([
    ...loadCommands,
    { command: ["set_property", "pause", false] },
  ]);
  if (startOffset > 0) {
    sendMpvCommand({ command: ["seek", startOffset, "absolute", "exact"] });
  }
}

function setTrackState(song: ServerSong, position: number) {
  state.current = song;
  state.playing = true;
  state.position = position;
  state.pausedAt = position;
  state.startedAt = Date.now();
  state.error = null;
  runtime.scrobbledCurrent = false;
  // Reports "now playing" to Navidrome; errors here shouldn't disrupt playback.
  scrobble(song.id, false).catch(() => {});
}

function handleMpvEvent(event: Record<string, unknown>) {
  if (event.event === "property-change") {
    if (event.name === "time-pos" && typeof event.data === "number") {
      state.position = event.data;
      state.pausedAt = event.data;
      if (state.playing) state.startedAt = Date.now();
      if (!runtime.scrobbledCurrent && state.current?.duration) {
        const threshold = Math.min(state.current.duration / 2, config.player.scrobbleThresholdSeconds);
        if (event.data >= threshold) {
          runtime.scrobbledCurrent = true;
          scrobble(state.current.id, true).catch(() => {});
        }
      }
    } else if (event.name === "duration" && typeof event.data === "number" && state.current) {
      state.current = { ...state.current, duration: event.data };
    } else if (event.name === "volume" && typeof event.data === "number") {
      // Ignore the echo of our own set_property: the mpv value is rounded, so
      // converting it back would nudge (or zero) the requested slider value.
      if (Math.round(event.data) !== volumeToMpv(state.volume)) state.volume = mpvToVolume(event.data);
    } else if (event.name === "pause" && typeof event.data === "boolean") {
      state.playing = !event.data;
      state.pausedAt = elapsedPosition();
      state.startedAt = state.playing ? Date.now() : null;
    }
    return;
  }
  if (event.event === "end-file" && event.reason === "eof") {
    const finishedId = state.current?.id;
    // Fallback for tracks that reach eof before crossing the threshold above
    // (e.g. very short tracks); avoid a duplicate submission otherwise.
    if (finishedId && !runtime.scrobbledCurrent) scrobble(finishedId, true).catch(() => {});
    runtime.playlistIndex += 1;
    const nextSong = runtime.playlist[runtime.playlistIndex];
    if (nextSong) {
      // mpv is already auto-advancing through its own playlist; mirror that here
      setTrackState(nextSong, 0);
      return;
    }
    if (finishedId) {
      runtime.ended = {
        seq: (runtime.ended?.seq ?? 0) + 1,
        songId: finishedId,
        at: Date.now(),
      };
    }
    state.current = null;
    state.playing = false;
    state.position = 0;
    state.pausedAt = 0;
    state.startedAt = null;
  }
}

export function seek(positionSeconds: number) {
  if (!state.current) return;
  const duration = state.current.duration;
  const target = Math.max(0, duration ? Math.min(positionSeconds, duration) : positionSeconds);
  state.position = target;
  state.pausedAt = target;
  if (runtime.backend === "mpv" && runtime.processRef) {
    sendMpvCommand({ command: ["seek", target, "absolute", "exact"] });
  }
}

export function pause() {
  if (!runtime.processRef || !state.playing) return;
  state.pausedAt = elapsedPosition();
  state.playing = false;
  state.startedAt = null;
  sendMpvCommand({ command: ["set_property", "pause", true] });
}

export function resume() {
  if (!runtime.processRef || state.playing) return;
  state.startedAt = Date.now();
  state.playing = true;
  sendMpvCommand({ command: ["set_property", "pause", false] });
}

export function stop() {
  stopProcess();
  runtime.backend = null;
  runtime.playlist = [];
  runtime.playlistIndex = 0;
  state.current = null;
  state.playing = false;
  state.position = 0;
  state.pausedAt = 0;
  state.startedAt = null;
}

export function setVolume(volume: number) {
  const requestedVolume = Math.max(0, Math.min(1, volume));
  state.volume = requestedVolume;
  if (runtime.backend === "mpv" && runtime.processRef) {
    sendMpvCommand({ command: ["set_property", "volume", volumeToMpv(state.volume)] });
  }
}

export function clearError() {
  state.error = null;
}