import "server-only";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AIUnavailableError, logError } from "./openai";

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, res: NextResponse.json({ error: "Invalid request" }, { status: 400 }) };
  return { ok: true, data: parsed.data };
}

export function errorResponse(route: string, err: unknown): NextResponse {
  if (err instanceof AIUnavailableError) return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  logError(route, err);
  return NextResponse.json({ error: "ai_failed" }, { status: 502 });
}

export const noStore = { "Cache-Control": "no-store" };
