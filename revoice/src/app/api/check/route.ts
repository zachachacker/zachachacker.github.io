import { NextResponse } from "next/server";
import { CheckRequest } from "@/lib/api/contracts";
import { aiCheck } from "@/lib/server/ai";
import { errorResponse, noStore, parseJson } from "@/lib/server/route-helpers";

export async function POST(req: Request) {
  const parsed = await parseJson(req, CheckRequest);
  if (!parsed.ok) return parsed.res;
  try {
    const result = await aiCheck(parsed.data, req.signal);
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    return errorResponse("check", e);
  }
}
