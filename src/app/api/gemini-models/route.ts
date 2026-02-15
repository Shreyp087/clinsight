import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: true, message: "Missing GEMINI_API_KEY" }, { status: 500 });

  const url = "https://generativelanguage.googleapis.com/v1beta/models";
  const resp = await fetch(url, {
    headers: { "x-goog-api-key": apiKey },
  });

  const raw = await resp.text();
  return NextResponse.json({ ok: resp.ok, status: resp.status, raw });
}

