import { NextRequest, NextResponse } from "next/server";
import { getAudioOutputs, getSettings, saveSettings } from "@/lib/settings";
import { getBackend } from "@/lib/server-player";
import { subsonicRequest } from "@/lib/subsonic";

export async function GET() {
  const navidrome = await subsonicRequest("ping")
    .then((response) => ({ connected: true, version: response.version as string }))
    .catch(() => ({ connected: false, version: null }));

  return NextResponse.json(
    {
      settings: getSettings(),
      outputs: getAudioOutputs(),
      host: { platform: process.platform, backend: getBackend() },
      navidrome,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { audioOutput?: string };
  if (!body.audioOutput || body.audioOutput.length > 300) return NextResponse.json({ error: "Invalid audio output" }, { status: 400 });
  return NextResponse.json({ settings: saveSettings({ audioOutput: body.audioOutput }) });
}