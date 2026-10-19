import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { rmSync } from "node:fs";
import { subsonicUrl } from "@/lib/subsonic";
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
};

const globalRuntime = globalThis as typeof globalThis & {
  __remoteplayPlayer?: PlayerRuntime;
};

let childCounter = 0;

const runtime = (globalRuntime.__remoteplayPlayer ??= {
  state: {
    current: null,
    playing: false,
    position: 0,
    volume: 0.8,
    startedAt: null,
    pausedAt: 0,
    error: null,
  },
  processRef: null,
  activeChildId: 0,
  backend: null,
  mpvIpcPath: null,
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

function findBackend(): PlayerBackend {
  try {
    execFileSync("which", ["mpv"], { stdio: "ignore" });
    return "mpv";
  } catch {
    throw new Error("No server audio player found. Install mpv on the server.");
  }
}

function elapsedPosition() {
  if (!state.playing || state.startedAt === null) return state.pausedAt;
  return state.pausedAt + (Date.now() - state.startedAt) / 1000;
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

export function getPlayerState() {
  return {
    current: state.current,
    playing: state.playing,
    position: elapsedPosition(),
    volume: state.volume,
    error: state.error,
    available: Boolean(runtime.processRef) || canPlay(),
  };
}

export function canPlay() {
  try {
    findBackend();
    return true;
  } catch {
    return false;
  }
}

export function getBackend(): PlayerBackend | null {
  try {
    return findBackend();
  } catch {
    return null;
  }
}

export function getAudioControlCapabilities() {
  return {
    volume: getBackend() === "mpv",
    outputSelection: getBackend() === "mpv",
  };
}

export function play(song: ServerSong, startOffset = 0) {
  const url = subsonicUrl("stream", { id: song.id });
  if (!url) throw new Error("Navidrome is not configured");

  findBackend();
  if (runtime.processRef && runtime.backend === "mpv" && runtime.mpvIpcPath) {
    sendMpvCommands([
      { command: ["loadfile", url, "replace"] },
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
  const volInt = Math.max(0, Math.min(100, Math.round(state.volume * 100)));

  const mpvIpcPath = `/tmp/remoteplay-mpv-${process.pid}.sock`;
  rmSync(mpvIpcPath, { force: true });
  runtime.mpvIpcPath = mpvIpcPath;
  const child = spawn("mpv", [
    "--no-video",
    "--really-quiet",
    "--force-window=no",
    "--idle=yes",
    `--input-ipc-server=${mpvIpcPath}`,
    `--volume=${volInt}`,
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
  sendMpvCommand({ command: ["observe_property", 1, "time-pos"] });
  sendMpvCommand({ command: ["observe_property", 2, "duration"] });
  sendMpvCommand({ command: ["observe_property", 3, "volume"] });
  sendMpvCommand({ command: ["observe_property", 4, "pause"] });
  sendMpvCommands([
    { command: ["loadfile", url, "replace"] },
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
}

function handleMpvEvent(event: Record<string, unknown>) {
  if (event.event === "property-change") {
    if (event.name === "time-pos" && typeof event.data === "number") {
      state.position = event.data;
      state.pausedAt = event.data;
      if (state.playing) state.startedAt = Date.now();
    } else if (event.name === "duration" && typeof event.data === "number" && state.current) {
      state.current = { ...state.current, duration: event.data };
    } else if (event.name === "volume" && typeof event.data === "number") {
      state.volume = Math.max(0, Math.min(1, event.data / 100));
    } else if (event.name === "pause" && typeof event.data === "boolean") {
      state.playing = !event.data;
      state.pausedAt = elapsedPosition();
      state.startedAt = state.playing ? Date.now() : null;
    }
    return;
  }
  if (event.event === "end-file" && event.reason === "eof") {
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
    sendMpvCommand({ command: ["set_property", "volume", Math.round(state.volume * 100)] });
  }
}

export function clearError() {
  state.error = null;
}