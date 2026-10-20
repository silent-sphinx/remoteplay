import crypto from "node:crypto";

const apiVersion = "1.16.1";
const clientName = "remoteplay";

export function getSubsonicConfig() {
  const url = process.env.NAVIDROME_URL?.replace(/\/$/, "");
  const username = process.env.NAVIDROME_USER;
  const password = process.env.NAVIDROME_PASSWORD;
  if (!url || !username || !password) return null;
  return { url, username, password };
}

export function subsonicUrl(method: string, params: Record<string, string> = {}) {
  const config = getSubsonicConfig();
  if (!config) return null;
  const salt = crypto.randomBytes(8).toString("hex");
  const token = crypto.createHash("md5").update(`${config.password}${salt}`).digest("hex");
  const query = new URLSearchParams({ u: config.username, t: token, s: salt, v: apiVersion, c: clientName, f: "json", ...params });
  return `${config.url}/rest/${method}.view?${query.toString()}`;
}

export async function subsonicRequest(method: string, params: Record<string, string> = {}) {
  const url = subsonicUrl(method, params);
  if (!url) throw new Error("Navidrome is not configured");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Navidrome returned ${response.status}`);
  const payload = await response.json();
  const subsonic = payload["subsonic-response"];
  if (subsonic?.status !== "ok") throw new Error(subsonic?.error?.message || "Navidrome request failed");
  return subsonic;
}

export async function scrobble(id: string, submission: boolean) {
  await subsonicRequest("scrobble", { id, submission: String(submission) });
}

export function coverArtUrl(id: string | undefined, size = "640") {
  if (!id) return null;
  return `/api/cover/${encodeURIComponent(id)}?size=${size}`;
}