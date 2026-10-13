import { NextRequest } from "next/server";
import { subsonicUrl } from "@/lib/subsonic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = subsonicUrl("getCoverArt", { id: decodeURIComponent(id), size: request.nextUrl.searchParams.get("size") || "640" });
  if (!url) return new Response("Navidrome is not configured", { status: 503 });
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return new Response("Cover art unavailable", { status: response.status });
  // Cover art is addressed by a content hash, so it never changes for a given id+size: cache it hard.
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}