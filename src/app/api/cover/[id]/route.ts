import { NextRequest } from "next/server";
import { isAllowedSize, loadCover } from "@/lib/cover-cache";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: encoded } = await params;
  let id: string;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    // A proxy may have decoded the path already, leaving a stray escape behind.
    id = encoded;
  }

  const size = request.nextUrl.searchParams.get("size") || "640";
  if (!isAllowedSize(size)) return new Response("Unsupported cover size", { status: 400 });

  const result = await loadCover(id, size);
  if ("status" in result) return new Response("Cover art unavailable", { status: result.status });

  const { cover } = result;
  // Cover art is addressed by a content hash, so it never changes for a given id+size: cache it hard.
  const headers: Record<string, string> = {
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: cover.etag,
  };
  if (request.headers.get("if-none-match") === cover.etag) return new Response(null, { status: 304, headers });

  // A known length lets a proxy in front send the image without chunking it.
  return new Response(cover.open(), {
    headers: { ...headers, "Content-Type": cover.contentType, "Content-Length": String(cover.length) },
  });
}
