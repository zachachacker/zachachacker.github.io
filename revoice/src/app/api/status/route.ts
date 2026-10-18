import { NextResponse } from "next/server";
import { chatModel, getOpenAI } from "@/lib/server/openai";
import type { StatusResponse } from "@/lib/api/contracts";

export const dynamic = "force-dynamic";

export function GET() {
  const ai = getOpenAI() !== null;
  const body: StatusResponse = { ai, transcription: ai, model: ai ? chatModel() : null };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
