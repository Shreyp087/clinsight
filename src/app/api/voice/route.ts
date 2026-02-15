import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  text: z.string().min(5).max(2500),
});

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey) {
      return NextResponse.json({ error: true, message: "Missing ELEVENLABS_API_KEY" }, { status: 500 });
    }
    if (!voiceId) {
      return NextResponse.json({ error: true, message: "Missing ELEVENLABS_VOICE_ID" }, { status: 500 });
    }

    const { text } = BodySchema.parse(await req.json());

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return NextResponse.json(
        { error: true, message: "ElevenLabs request failed", detail: errText },
        { status: 500 }
      );
    }

    const audio = await r.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: true, message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

