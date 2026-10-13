import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { subsonicUrl } from "@/lib/subsonic";
import { getSettings } from "@/lib/settings";

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

export function play(song: ServerSong) {
  // Stream native format without lossy re-encoding; mpv & ffplay handle flac, mp3, m4a, opus natively
  const url = subsonicUrl("stream", { id: song.id });
  if (!url) throw new Error("Navidrome is not configured");

  const backend = findBackend();
  stopProcess();

  const currentChildId = ++childCounter;
  runtime.activeChildId = currentChildId;

  const output = getSettings().audioOutput;
  const volInt = Math.max(0, Math.min(100, Math.round(state.volume * 100)));

  let args: string[] = [];
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

  if (backend === "mpv") {
    args = [
      "--no-video",
      "--really-quiet",
      "--force-window=no",
      `--volume=${volInt}`,
      "--network-timeout=15",
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
    if (output !== "auto") {
      args.unshift("-a", output);
    }
  }

  const child = spawn(backend, args, {
    stdio: ["ignore", "ignore", "pipe"],
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
  state.position = 0;
  state.pausedAt = 0;
  state.startedAt = Date.now();
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
  state.current = null;
  state.playing = false;
  state.position = 0;
  state.pausedAt = 0;
  state.startedAt = null;
}

export function setVolume(volume: number) {
  state.volume = Math.max(0, Math.min(1, volume));
}

export function clearError() {
  state.error = null;
}