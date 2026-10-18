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
type PlayerBackend = "mpv" | "ffplay" | "mpg123";

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
  for (const command of ["mpv", "ffplay", "mpg123"] as const) {
    try {
      execFileSync("which", [command], { stdio: "ignore" });
      return command;
    } catch {
      /* Try the next supported backend. */
    }
  }
  throw new Error(
    "No server audio player found. Install mpv, ffplay, or mpg123 on the server.",
  );
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
      setTimeout(() => sendMpvCommand(command, attempt + 1), 50);
    }
  });
  socket.once("connect", () => {
    socket.end(`${JSON.stringify(command)}\n`);
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
  const backend = getBackend();
  return {
    volume: backend === "mpv" || backend === "ffplay",
    outputSelection: backend === "mpv" || (process.platform === "linux" && backend === "ffplay"),
  };
}

// MPEG1 Layer3 frames are 1152 samples; at the common 44.1kHz rate that is
// ~38.28 frames/sec, used to approximate a seek target as a frame skip since
// mpg123 has no time-based seek flag.
const MPG123_FRAMES_PER_SECOND = 44100 / 1152;

export function play(song: ServerSong, startOffset = 0) {
  // Stream native format without lossy re-encoding; mpv & ffplay handle flac, mp3, m4a, opus natively
  const url = subsonicUrl("stream", { id: song.id });
  if (!url) throw new Error("Navidrome is not configured");

  const backend = findBackend();
  stopProcess();
  runtime.backend = backend;

  const currentChildId = ++childCounter;
  runtime.activeChildId = currentChildId;

  const configuredOutput = getSettings().audioOutput;
  const canSelectOutput = backend === "mpv" || (process.platform === "linux" && backend === "ffplay");
  const output = canSelectOutput && isValidAudioOutput(configuredOutput)
    ? configuredOutput
    : "auto";
  const volInt = Math.max(0, Math.min(100, Math.round(state.volume * 100)));

  let args: string[] = [];
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

  if (backend === "mpv") {
    const mpvIpcPath = `/tmp/remoteplay-mpv-${process.pid}.sock`;
    rmSync(mpvIpcPath, { force: true });
    runtime.mpvIpcPath = mpvIpcPath;
    args = [
      "--no-video",
      "--really-quiet",
      "--force-window=no",
      `--input-ipc-server=${mpvIpcPath}`,
      `--volume=${volInt}`,
      "--network-timeout=15",
      ...(startOffset > 0 ? [`--start=${startOffset}`] : []),
      ...(output !== "auto" ? [`--audio-device=${output}`] : []),
      url,
    ];
  } else if (backend === "ffplay") {
    // ffplay: NEVER pass -audio_device_index (it is an input-only flag that causes fatal exit code 1)
    args = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "error",
      "-vn",
      ...(startOffset > 0 ? ["-ss", String(startOffset)] : []),
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-volume",
      String(volInt),
      url,
    ];
    if (process.platform === "linux" && output !== "auto") {
      spawnEnv.PULSE_SINK = output;
    }
  } else {
    args = ["-q", url];
    if (startOffset > 0) {
      args.push("-k", String(Math.round(startOffset * MPG123_FRAMES_PER_SECOND)));
    }
    if (output !== "auto") {
      args.unshift("-a", output);
    }
  }

  const child = spawn(backend, args, {
    stdio: [backend === "ffplay" ? "pipe" : "ignore", "ignore", "pipe"],
    env: spawnEnv,
  });

  runtime.processRef = child;
  state.error = null;

  // Keep the tail of stderr so an abnormal exit can report the real cause
  const spawnTime = Date.now();
  let stderrTail = "";

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
    state.error = `Could not start ${backend}: ${error.message}`;
    state.playing = false;
    runtime.processRef = null;
  });

  child.once("exit", (code, signal) => {
    // Guard against race conditions when a new track has already superseded this child
    if (runtime.activeChildId !== currentChildId || runtime.processRef !== child) return;
    runtime.processRef = null;

    const playedFor = (Date.now() - spawnTime) / 1000;
    const stopped = signal === "SIGTERM" || signal === "SIGINT" || code === 123 || code === 130 || code === 143;

    if (!state.error && !stopped) {
      if (code !== 0) {
        // Abnormal exit code: surface the backend's own stderr when we have it
        state.error = stderrTail || `${backend} exited unexpectedly (code ${code}).`;
      } else if (playedFor < 1.5) {
        // Clean exit almost immediately means the host never actually played audio
        // (missing/misconfigured audio output, unplayable stream). Report it so the
        // client does not silently auto-advance through the whole queue.
        state.error = stderrTail
          ? `Playback ended immediately: ${stderrTail}`
          : "Playback ended immediately. Check the host audio output device in Settings.";
      }
    }

    state.current = null;
    state.playing = false;
    state.position = 0;
    state.pausedAt = 0;
    state.startedAt = null;
  });

  state.current = song;
  state.playing = true;
  state.position = startOffset;
  state.pausedAt = startOffset;
  state.startedAt = Date.now();
}

export function seek(positionSeconds: number) {
  if (!state.current) return;
  const duration = state.current.duration;
  const target = Math.max(0, duration ? Math.min(positionSeconds, duration) : positionSeconds);
  const wasPlaying = state.playing;
  play(state.current, target);
  if (!wasPlaying) pause();
}

export function pause() {
  if (!runtime.processRef || !state.playing) return;
  state.pausedAt = elapsedPosition();
  state.playing = false;
  state.startedAt = null;
  try {
    runtime.processRef.kill("SIGSTOP");
  } catch {
    /* ignore */
  }
}

export function resume() {
  if (!runtime.processRef || state.playing) return;
  state.startedAt = Date.now();
  state.playing = true;
  try {
    runtime.processRef.kill("SIGCONT");
  } catch {
    /* ignore */
  }
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
  const backend = runtime.backend;
  const ffplayStdin = backend === "ffplay" ? runtime.processRef?.stdin : null;
  const previousVolume = state.volume;
  const requestedVolume = Math.max(0, Math.min(1, volume));
  state.volume = ffplayStdin
    ? Math.round(requestedVolume / 0.05) * 0.05
    : requestedVolume;
  if (backend === "mpv" && runtime.processRef) {
    sendMpvCommand({ command: ["set", "volume", Math.round(state.volume * 100)] });
  } else if (ffplayStdin) {
    const stepCount = Math.round(Math.abs(state.volume - previousVolume) / 0.05);
    const command = state.volume >= previousVolume ? "0" : "9";
    ffplayStdin.write(command.repeat(stepCount));
  } else if (backend && runtime.processRef && state.current) {
    // Fallback players only read volume at startup, so preserve the position
    // while recreating the process with the new volume.
    const position = elapsedPosition();
    const wasPlaying = state.playing;
    play(state.current, position);
    if (!wasPlaying) pause();
  }
}

export function clearError() {
  state.error = null;
}