import crypto from "node:crypto";
import { config as appConfig, getNavidromeConfig } from "@/lib/config";

export function subsonicUrl(method: string, params: Record<string, string> = {}) {
  const config = getNavidromeConfig();
  if (!config) return null;
  const salt = crypto.randomBytes(8).toString("hex");
  const token = crypto.createHash("md5").update(`${config.password}${salt}`).digest("hex");
  const query = new URLSearchParams({ u: config.username, t: token, s: salt, v: appConfig.subsonic.apiVersion, c: appConfig.subsonic.clientName, f: "json", ...params });
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