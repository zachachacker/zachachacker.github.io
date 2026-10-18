import { NextResponse } from "next/server";
import { SegmentRequest } from "@/lib/api/contracts";
import { aiSegment } from "@/lib/server/ai";
import { errorResponse, noStore, parseJson } from "@/lib/server/route-helpers";

export async function POST(req: Request) {
  const parsed = await parseJson(req, SegmentRequest);
  if (!parsed.ok) return parsed.res;
  try {
    const result = await aiSegment(parsed.data, req.signal);
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    return errorResponse("segment", e);
  }
}
