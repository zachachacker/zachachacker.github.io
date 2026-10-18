import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/api/contracts";
import { getOpenAI, transcribeModel } from "@/lib/server/openai";
import { errorResponse, noStore } from "@/lib/server/route-helpers";

/**
 * Transcribes one utterance for the server-side speech provider. The audio is
 * forwarded to OpenAI and discarded; nothing is written to disk or logged.
 */
export async function POST(req: Request) {
  const openai = getOpenAI();
  if (!openai) return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: "Missing audio" }, { status: 400 });
  if (audio.size > LIMITS.MAX_AUDIO_BYTES) return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  const language = String(form.get("language") ?? "").slice(0, 2).toLowerCase();
  const prompt = String(form.get("prompt") ?? "").slice(0, 800);
  try {
    const result = await openai.audio.transcriptions.create(
      {
        file: audio,
        model: transcribeModel(),
        ...(/^[a-z]{2}$/.test(language) ? { language } : {}),
        // Spelling hints only (names from the original), so the transcript reflects what was said, not the original text.
        ...(prompt ? { prompt } : {}),
      },
      { signal: req.signal },
    );
    return NextResponse.json({ text: result.text ?? "" }, { headers: noStore });
  } catch (e) {
    return errorResponse("transcribe", e);
  }
}
