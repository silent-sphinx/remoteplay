import { NextRequest, NextResponse } from "next/server";
import { clearError, getPlayerState, pause, play, resume, seek, setVolume, stop, type ServerSong } from "@/lib/server-player";

export async function GET() {
  return NextResponse.json(getPlayerState(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: string; song?: ServerSong; volume?: number; position?: number; afterEnd?: number };
    if (body.action === "play" && body.song) play(body.song, 0, body.afterEnd);
    else if (body.action === "pause") pause();
    else if (body.action === "resume") resume();
    else if (body.action === "stop") stop();
    else if (body.action === "seek" && typeof body.position === "number") seek(body.position);
    else if (body.action === "volume" && typeof body.volume === "number") setVolume(body.volume);
    else if (body.action === "clearError") clearError();
    else return NextResponse.json({ error: "Invalid player command" }, { status: 400 });
    return NextResponse.json(getPlayerState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start server playback" }, { status: 503 });
  }
}