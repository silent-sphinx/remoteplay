import { NextRequest, NextResponse } from "next/server";
import { getAudioOutputs, getSettings, isValidAudioOutput, saveSettings } from "@/lib/settings";
import { getAudioControlCapabilities, getBackend } from "@/lib/server-player";
import { subsonicRequest } from "@/lib/subsonic";

export async function GET() {
  const navidrome = await subsonicRequest("ping")
    .then((response) => ({ connected: true, version: response.version as string }))
    .catch(() => ({ connected: false, version: null }));
  const outputs = getAudioOutputs();
  const storedSettings = getSettings();
  const settings = storedSettings.audioOutput === "auto" || outputs.some((output) => output.id === storedSettings.audioOutput)
    ? storedSettings
    : { ...storedSettings, audioOutput: "auto" };

  return NextResponse.json(
    {
      settings,
      outputs,
      host: { platform: process.platform, backend: getBackend(), capabilities: getAudioControlCapabilities() },
      navidrome,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { audioOutput?: string };
  if (!body.audioOutput || body.audioOutput.length > 300 || !isValidAudioOutput(body.audioOutput)) {
    return NextResponse.json({ error: "That audio output is not available on the host" }, { status: 400 });
  }
  return NextResponse.json({ settings: saveSettings({ audioOutput: body.audioOutput }) });
}