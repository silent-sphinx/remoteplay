import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { subsonicUrl } from "@/lib/subsonic";

// The service user is only guaranteed read access to the install directory, so the
// cache prefers systemd's CacheDirectory and falls back to the temp dir.
const cacheDir = process.env.REMOTEPLAY_COVER_CACHE
  || (process.env.CACHE_DIRECTORY ? path.join(process.env.CACHE_DIRECTORY, "covers") : path.join(os.tmpdir(), "remoteplay-covers"));

// Only the sizes the UI asks for are accepted, so hand-made URLs cannot grow the key space.
const allowedSizes = new Set(["120", "400", "640"]);

const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const contentTypes: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export type Cover = { contentType: string; etag: string; length: number; open: () => BodyInit };
export type CoverResult = { cover: Cover } | { status: number };

export function isAllowedSize(size: string) {
  return allowedSizes.has(size);
}

function cacheKey(id: string, size: string) {
  return `${crypto.createHash("sha1").update(id).digest("hex")}-${size}`;
}

async function findCached(key: string) {
  for (const extension of Object.keys(contentTypes)) {
    const file = path.join(cacheDir, `${key}.${extension}`);
    try {
      const info = await stat(file);
      return { file, length: info.size, contentType: contentTypes[extension] };
    } catch { /* Try the next encoding. */ }
  }
  return null;
}

async function writeCached(key: string, contentType: string, body: ArrayBuffer) {
  const extension = extensions[contentType];
  if (!extension) return;
  const file = path.join(cacheDir, `${key}.${extension}`);
  const temp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(temp, new Uint8Array(body));
    // Rename last so a concurrent reader never opens a half-written cover.
    await rename(temp, file);
    schedulePrune();
  } catch { /* Serving the bytes matters more than caching them. */ }
}

// Covers accumulate on a small disk, so keep the directory to a bounded number of
// files, dropping the oldest writes first.
const maxEntries = Number(process.env.REMOTEPLAY_COVER_CACHE_ENTRIES) || 3000;
const pruneInterval = 200;
let writesSincePrune = 0;
let pruning = false;

function schedulePrune() {
  writesSincePrune += 1;
  if (writesSincePrune < pruneInterval || pruning) return;
  writesSincePrune = 0;
  pruning = true;
  prune().catch(() => { /* A full cache is not worth failing a request over. */ }).finally(() => { pruning = false; });
}

async function prune() {
  const names = await readdir(cacheDir);
  if (names.length <= maxEntries) return;
  const entries = [];
  for (const name of names) {
    try {
      const info = await stat(path.join(cacheDir, name));
      entries.push({ name, at: info.mtimeMs });
    } catch { /* Already gone. */ }
  }
  entries.sort((a, b) => a.at - b.at);
  for (const entry of entries.slice(0, entries.length - Math.floor(maxEntries * 0.9))) {
    await unlink(path.join(cacheDir, entry.name)).catch(() => { /* Already gone. */ });
  }
}

// Navidrome resizes on demand, and HTTP/2 lets a browser ask for a whole grid at
// once, so cap the resizes this process can have in flight upstream.
const maxUpstream = Number(process.env.REMOTEPLAY_COVER_CONCURRENCY) || 4;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  if (active < maxUpstream) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  // Hand the slot straight to the next waiter rather than reopening it.
  if (next) next();
  else active -= 1;
}

// Identical concurrent requests share one upstream fetch, and misses are remembered
// briefly so a gridful of art-less albums does not re-ask on every render.
const inflight = new Map<string, Promise<CoverResult>>();
const missing = new Map<string, number>();
const missingTtlMs = 5 * 60_000;

export async function loadCover(id: string, size: string): Promise<CoverResult> {
  const key = cacheKey(id, size);
  const etag = `"${key}"`;

  const cached = await findCached(key);
  if (cached) return { cover: { ...cached, etag, open: () => openFile(cached.file) } };

  const failedAt = missing.get(key);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < missingTtlMs) return { status: 404 };
    missing.delete(key);
  }

  const pending = inflight.get(key);
  if (pending) return pending;
  const fetching = fetchCover(id, size, key, etag);
  inflight.set(key, fetching);
  try {
    return await fetching;
  } finally {
    inflight.delete(key);
  }
}

async function fetchCover(id: string, size: string, key: string, etag: string): Promise<CoverResult> {
  const url = subsonicUrl("getCoverArt", { id, size });
  if (!url) return { status: 503 };

  await acquire();
  let contentType: string;
  let body: ArrayBuffer;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) missing.set(key, Date.now());
      return { status: response.status };
    }
    // Strip any charset parameter so the type still matches the extension table.
    contentType = (response.headers.get("Content-Type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    body = await response.arrayBuffer();
  } catch {
    return { status: 502 };
  } finally {
    release();
  }

  // Navidrome answers a missing cover with a JSON error and a 200, so anything that
  // is not an image counts as a miss rather than something to cache.
  if (!contentType.startsWith("image/")) {
    missing.set(key, Date.now());
    return { status: 404 };
  }
  await writeCached(key, contentType, body);
  return { cover: { contentType, etag, length: body.byteLength, open: () => body } };
}

function openFile(file: string) {
  return Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
}
