/**
 * Offline (non-AI) whole-document review. Like the per-segment heuristics it
 * only reports what it can detect mechanically: unresolved segment issues,
 * repeated sentences, and numbers/names/dates missing from the whole text.
 */

import type { ConsistencyReview, ReviewFinding, RevoiceDocument } from "../types";
import { uid, nowISO } from "../id";
import { currentText, unresolvedImportantIssues } from "../document/operations";
import { assembleRewritten } from "../document/reconstruct";
import { extractDateTokens, extractNames, extractNumbers, heuristicCheck } from "./heuristics";

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2));
}

function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size < 4 || B.size < 4) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / Math.min(A.size, B.size);
}

function sentences(s: string): string[] {
  return s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

export function heuristicReview(doc: RevoiceDocument, basedOn: string): ConsistencyReview {
  const findings: ReviewFinding[] = [];
  const rewritten = doc.segments
    .map((s) => ({ seg: s, text: s.status === "skipped" ? null : currentText(s) }))
    .filter((x): x is { seg: typeof x.seg; text: string } => !!x.text && x.seg.revisions.length > 0);

  // 1. Segment-level issues that are still open.
  for (const { seg, text } of rewritten) {
    const open = seg.check && seg.check.checkedText === text ? unresolvedImportantIssues(seg) : heuristicCheck(seg.originalText, text).issues.filter((i) => i.severity === "important");
    for (const issue of open) {
      findings.push({
        id: uid("fnd"),
        kind: issue.kind === "missing_detail" ? "missing_information" : "meaning_change",
        category: "meaning",
        segmentIds: [seg.id],
        explanation: `${issue.detail} ${issue.explanation}`.trim(),
        status: "open",
      });
    }
  }

  // 2. Repeated sentences across segments (e.g. said the next idea early, then again).
  for (let i = 0; i < rewritten.length; i++) {
    for (let j = i + 1; j < rewritten.length; j++) {
      const a = sentences(rewritten[i].text);
      const b = sentences(rewritten[j].text);
      const dup = b.find((sb) => a.some((sa) => similarity(sa, sb) >= 0.85));
      if (dup) {
        findings.push({
          id: uid("fnd"),
          kind: "repetition",
          category: "meaning",
          segmentIds: [rewritten[i].seg.id, rewritten[j].seg.id],
          explanation: `“${dup}” is said twice.`,
          fix: { segmentId: rewritten[j].seg.id, from: dup, to: "" },
          status: "open",
        });
      }
    }
  }

  // 3. Whole-document check for concrete details that vanished entirely.
  const full = assembleRewritten(doc);
  const fullLower = full.toLowerCase();
  const fullNums = new Set(extractNumbers(full, { includeOrdinalWords: true, includeOne: true }).map((n) => n.value));
  const missingNums = extractNumbers(doc.original.text).filter((n) => !fullNums.has(n.value));
  const missingNames = extractNames(doc.original.text).filter((n) => !fullLower.includes(n.toLowerCase()));
  const fullDates = extractDateTokens(full);
  const missingDates = extractDateTokens(doc.original.text).filter((d) => !fullDates.includes(d));
  const missing = [...missingNums.map((n) => n.raw), ...missingNames, ...missingDates];
  if (missing.length) {
    findings.push({
      id: uid("fnd"),
      kind: "missing_information",
      category: "meaning",
      segmentIds: [],
      explanation: `These details from the original don’t appear anywhere in your version: ${[...new Set(missing)].join(", ")}.`,
      status: "open",
    });
  }

  // Fixes for repetitions are removals; fine to keep, but never auto-applied.
  return { source: "heuristic", createdAt: nowISO(), basedOn, findings };
}
