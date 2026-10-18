import { NextResponse } from "next/server";
import { ReviewRequest } from "@/lib/api/contracts";
import { aiReview } from "@/lib/server/ai";
import { errorResponse, noStore, parseJson } from "@/lib/server/route-helpers";

export const maxDuration = 60;

export async function POST(req: Request) {
  const parsed = await parseJson(req, ReviewRequest);
  if (!parsed.ok) return parsed.res;
  try {
    const result = await aiReview(parsed.data, req.signal);
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    return errorResponse("review", e);
  }
}
