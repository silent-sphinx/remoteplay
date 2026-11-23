import { NextRequest, NextResponse } from "next/server";
import { getAudioOutputs, getSettings, isValidAudioOutput, saveSettings } from "@/lib/settings";
import { getAudioControlCapabilities, getBackend, setBalance } from "@/lib/server-player";
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
  const body = await request.json() as { audioOutput?: string; balance?: number };
  if (
    body.audioOutput !== undefined &&
    (!body.audioOutput || body.audioOutput.length > 300 || !isValidAudioOutput(body.audioOutput))
  ) {
    return NextResponse.json({ error: "That audio output is not available on the host" }, { status: 400 });
  }
  if (
    body.balance !== undefined &&
    (typeof body.balance !== "number" || !Number.isFinite(body.balance) || body.balance < -1 || body.balance > 1)
  ) {
    return NextResponse.json({ error: "Balance must be between -1 and 1" }, { status: 400 });
  }

  const next = saveSettings({
    ...(body.audioOutput !== undefined ? { audioOutput: body.audioOutput } : {}),
    ...(body.balance !== undefined ? { balance: body.balance } : {}),
  });
  if (body.balance !== undefined) setBalance(body.balance);
  return NextResponse.json({ settings: next });
}