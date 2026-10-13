import { NextRequest, NextResponse } from "next/server";
import { getAudioOutputs, getSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), outputs: getAudioOutputs() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { audioOutput?: string };
  if (!body.audioOutput || body.audioOutput.length > 300) return NextResponse.json({ error: "Invalid audio output" }, { status: 400 });
  return NextResponse.json({ settings: saveSettings({ audioOutput: body.audioOutput }) });
}