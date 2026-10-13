import { NextRequest } from "next/server";
import { subsonicUrl } from "@/lib/subsonic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = subsonicUrl("stream", { id: decodeURIComponent(id), maxBitRate: "320" });
  if (!url) return new Response("Navidrome is not configured", { status: 503 });
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return new Response("Stream unavailable", { status: response.status });
  return new Response(response.body, { headers: { "Content-Type": response.headers.get("Content-Type") || "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
}