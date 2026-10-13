import { NextRequest, NextResponse } from "next/server";
import { subsonicRequest } from "@/lib/subsonic";

export async function GET(request: NextRequest) {
  const method = request.nextUrl.searchParams.get("method");
  if (!method || !/^[a-zA-Z0-9]+$/.test(method)) return NextResponse.json({ error: "A valid Subsonic method is required" }, { status: 400 });
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  delete params.method;
  try { return NextResponse.json(await subsonicRequest(method, params)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach Navidrome";
    const status = message === "Wrong username or password" ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}