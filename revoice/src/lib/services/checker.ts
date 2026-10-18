import type { MeaningCheck, ReviewFinding, RevoiceDocument, Segment, Settings, ConsistencyReview } from "../types";
import { api, type ApiFailure } from "../api/client";
import { heuristicCheck } from "../meaning/heuristics";
import { currentText } from "../document/operations";
import { assembleRewritten, segmentOutput } from "../document/reconstruct";
import { uid, nowISO, hashText } from "../id";
import { heuristicReview } from "../meaning/review-heuristics";

export interface CheckOutcome {
  check: MeaningCheck;
  /** Set when the AI was wanted but couldn't be used. */
  fallback?: ApiFailure;
}

export async function checkSegment(
  doc: RevoiceDocument,
  segmentId: string,
  rewrite: string,
  settings: Pick<Settings, "aiEnabled" | "cleanup">,
  signal?: AbortSignal,
): Promise<CheckOutcome> {
  const i = doc.segments.findIndex((s) => s.id === segmentId);
  const seg = doc.segments[i];
  const prev: Segment | undefined = doc.segments[i - 1];
  const next: Segment | undefined = doc.segments[i + 1];

  if (settings.aiEnabled) {
    const res = await api.check(
      {
        original: seg.originalText,
        previousOriginal: prev?.originalText,
        previousRewrite: prev ? currentText(prev) ?? undefined : undefined,
        nextOriginal: next?.originalText,
        keyPoints: seg.keyPoints,
        rewrite,
        cleanup: settings.cleanup,
      },
      signal,
    );
    if (res.ok) {
      return {
        check: {
          verdict: res.data.verdict,
          issues: res.data.issues.map((x) => ({ ...x, id: uid("iss") })),
          suggestions: res.data.suggestions.map((x) => ({ ...x, id: uid("sug") })),
          source: "ai",
          checkedText: rewrite,
          checkedAt: nowISO(),
        },
      };
    }
    // Fall back so the user is never blocked by the network; re-check with AI later.
    return { check: { ...heuristicCheck(seg.originalText, rewrite), needsRecheck: true }, fallback: res.reason };
  }
  return { check: heuristicCheck(seg.originalText, rewrite) };
}

export async function reviewDocument(
  doc: RevoiceDocument,
  aiEnabled: boolean,
  signal?: AbortSignal,
): Promise<{ review: ConsistencyReview; fallback?: ApiFailure }> {
  const basedOn = hashText(assembleRewritten(doc));
  if (aiEnabled) {
    const res = await api.review(
      {
        title: doc.title,
        original: doc.original.text,
        segments: doc.segments.map((s) => ({
          id: s.id,
          original: s.originalText,
          rewrite: segmentOutput(s).text,
          status: s.status,
        })),
      },
      signal,
    );
    if (res.ok) {
      const findings: ReviewFinding[] = res.data.findings.map((f) => ({
        id: uid("fnd"),
        kind: f.kind,
        category: f.category,
        segmentIds: f.segmentIds,
        explanation: f.explanation,
        fix: f.fix ?? undefined,
        status: "open",
      }));
      return { review: { source: "ai", createdAt: nowISO(), basedOn, findings } };
    }
    return { review: heuristicReview(doc, basedOn), fallback: res.reason };
  }
  return { review: heuristicReview(doc, basedOn) };
}
