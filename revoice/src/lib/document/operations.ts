/**
 * Pure state transitions on a RevoiceDocument. Every function returns a new
 * document; nothing mutates. The original text is never touched.
 */

import type {
  IssueResolution,
  MeaningCheck,
  Revision,
  RevisionSource,
  RevoiceDocument,
  Segment,
  SegmentStatus,
} from "../types";
import { uid, nowISO } from "../id";

export function createDocument(
  title: string,
  text: string,
  segments: Segment[],
  segmentationSource: "ai" | "heuristic",
): RevoiceDocument {
  const now = nowISO();
  return {
    id: uid("doc"),
    version: 1,
    title: title.trim() || deriveTitle(text),
    original: { text, importedAt: now, format: "plain-text" },
    segmentation: { source: segmentationSource, createdAt: now },
    segments,
    activeSegmentId: segments[0]?.id ?? null,
    finalEdit: null,
    review: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

export function deriveTitle(text: string): string {
  const firstLine = text.trim().split("\n").find((l) => l.trim()) ?? "Untitled";
  const words = firstLine.trim().split(/\s+/).slice(0, 7).join(" ");
  return words.length < firstLine.trim().length ? `${words}…` : words;
}

export function currentRevision(seg: Segment): Revision | null {
  if (!seg.currentRevisionId) return null;
  return seg.revisions.find((r) => r.id === seg.currentRevisionId) ?? null;
}

export function currentText(seg: Segment): string | null {
  return currentRevision(seg)?.text ?? null;
}

export function isCheckStale(seg: Segment): boolean {
  const text = currentText(seg);
  if (text === null) return false;
  if (currentRevision(seg)?.source === "kept-original") return false;
  return !seg.check || seg.check.checkedText !== text;
}

export function unresolvedImportantIssues(seg: Segment) {
  return (seg.check?.issues ?? []).filter((i) => i.severity === "important" && !i.resolution);
}

export function computeStatus(seg: Segment): SegmentStatus {
  const rev = currentRevision(seg);
  if (!rev) return seg.status === "skipped" ? "skipped" : "pending";
  if (rev.source === "kept-original") return "completed";
  if (isCheckStale(seg)) return "flagged";
  return unresolvedImportantIssues(seg).length ? "flagged" : "completed";
}

function updateSegment(doc: RevoiceDocument, id: string, fn: (s: Segment) => Segment): RevoiceDocument {
  const now = nowISO();
  let changed = false;
  const segments = doc.segments.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    const next = fn(s);
    return { ...next, status: computeStatus(next), updatedAt: now };
  });
  if (!changed) return doc;
  return withCompletion({ ...doc, segments, updatedAt: now });
}

function withCompletion(doc: RevoiceDocument): RevoiceDocument {
  const done = doc.segments.every((s) => s.status === "completed" || s.status === "skipped");
  return { ...doc, completedAt: done ? doc.completedAt ?? nowISO() : null };
}

/**
 * Record a new version of a segment. Re-recording replaces the segment's
 * current text (the old one stays in history), so nothing is duplicated.
 */
export function addRevision(
  doc: RevoiceDocument,
  segmentId: string,
  input: { text: string; rawTranscript?: string; source: RevisionSource },
): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) => {
    const rev: Revision = {
      id: uid("rev"),
      text: input.text,
      rawTranscript: input.rawTranscript,
      source: input.source,
      createdAt: nowISO(),
    };
    return { ...s, revisions: [...s.revisions, rev], currentRevisionId: rev.id };
  });
}

/** Keep the original wording for this segment (useful for names, sign-offs, quotes). */
export function keepOriginal(doc: RevoiceDocument, segmentId: string): RevoiceDocument {
  const seg = doc.segments.find((s) => s.id === segmentId);
  if (!seg) return doc;
  return addRevision(doc, segmentId, { text: seg.originalText, source: "kept-original" });
}

/** Attach a meaning check; ignored if the text changed while the check was running. */
export function applyCheck(doc: RevoiceDocument, segmentId: string, check: MeaningCheck): RevoiceDocument {
  const seg = doc.segments.find((s) => s.id === segmentId);
  if (!seg || currentText(seg) !== check.checkedText) return doc;
  // Carry forward resolutions the user already gave for equivalent issues.
  const prior = seg.check?.checkedText === check.checkedText ? seg.check.issues : [];
  const issues = check.issues.map((i) => {
    const same = prior.find((p) => p.kind === i.kind && p.detail === i.detail && p.resolution);
    return same ? { ...i, resolution: same.resolution } : i;
  });
  return updateSegment(doc, segmentId, (s) => ({ ...s, check: { ...check, issues } }));
}

export function resolveIssue(
  doc: RevoiceDocument,
  segmentId: string,
  issueId: string,
  resolution: IssueResolution,
): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) =>
    s.check
      ? {
          ...s,
          check: {
            ...s.check,
            issues: s.check.issues.map((i) => (i.id === issueId ? { ...i, resolution } : i)),
          },
        }
      : s,
  );
}

/** "Keep my version": accept every open important issue on the segment. */
export function keepMyVersion(doc: RevoiceDocument, segmentId: string): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) =>
    s.check
      ? {
          ...s,
          check: {
            ...s.check,
            issues: s.check.issues.map((i) =>
              i.severity === "important" && !i.resolution ? { ...i, resolution: "kept" as const } : i,
            ),
          },
        }
      : s,
  );
}

/**
 * Undo: step the segment back to the revision before the current one. The
 * undone revision stays in history, so undo itself can be reversed with redo.
 */
export function undoRevision(doc: RevoiceDocument, segmentId: string): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) => {
    const idx = s.revisions.findIndex((r) => r.id === s.currentRevisionId);
    if (idx < 0) return s;
    const prev = idx > 0 ? s.revisions[idx - 1] : null;
    return { ...s, currentRevisionId: prev?.id ?? null, check: null, status: prev ? s.status : "pending" };
  });
}

export function redoRevision(doc: RevoiceDocument, segmentId: string): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) => {
    const idx = s.revisions.findIndex((r) => r.id === s.currentRevisionId);
    const next = s.revisions[idx + 1];
    return next ? { ...s, currentRevisionId: next.id, check: null } : s;
  });
}

export function canUndo(seg: Segment): boolean {
  return seg.currentRevisionId !== null;
}

export function canRedo(seg: Segment): boolean {
  const idx = seg.revisions.findIndex((r) => r.id === seg.currentRevisionId);
  return idx < seg.revisions.length - 1;
}

export function restoreRevision(doc: RevoiceDocument, segmentId: string, revisionId: string): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) =>
    s.revisions.some((r) => r.id === revisionId) ? { ...s, currentRevisionId: revisionId, check: null } : s,
  );
}

export function skipSegment(doc: RevoiceDocument, segmentId: string): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) => (s.currentRevisionId ? s : { ...s, status: "skipped" }));
}

export function setActive(doc: RevoiceDocument, segmentId: string | null): RevoiceDocument {
  if (doc.activeSegmentId === segmentId) return doc;
  return { ...doc, activeSegmentId: segmentId, updatedAt: nowISO() };
}

export function replaceSegments(doc: RevoiceDocument, segments: Segment[]): RevoiceDocument {
  const segs = segments.map((s) => ({ ...s, status: computeStatus(s) }));
  const activeStillExists = segs.some((s) => s.id === doc.activeSegmentId);
  return withCompletion({
    ...doc,
    segments: segs,
    activeSegmentId: activeStillExists ? doc.activeSegmentId : segs[0]?.id ?? null,
    review: null,
    updatedAt: nowISO(),
  });
}

export function progress(doc: RevoiceDocument): { done: number; total: number; percent: number } {
  const total = doc.segments.length;
  const done = doc.segments.filter((s) => s.status === "completed" || s.status === "skipped").length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** First segment that still needs the user's attention, starting after `fromId`. */
export function nextOpenSegment(doc: RevoiceDocument, fromId: string | null): Segment | null {
  const start = fromId ? doc.segments.findIndex((s) => s.id === fromId) + 1 : 0;
  const order = [...doc.segments.slice(start), ...doc.segments.slice(0, start)];
  return order.find((s) => s.status === "pending" || s.status === "flagged") ?? null;
}

/** Apply a user-approved wording suggestion as a new revision. */
export function applySuggestion(doc: RevoiceDocument, segmentId: string, suggestionId: string): RevoiceDocument {
  const seg = doc.segments.find((s) => s.id === segmentId);
  const sug = seg?.check?.suggestions?.find((x) => x.id === suggestionId);
  const text = seg ? currentText(seg) : null;
  if (!seg || !sug || text === null || !text.includes(sug.from)) return dismissSuggestion(doc, segmentId, suggestionId);
  return addRevision(doc, segmentId, { text: text.replace(sug.from, sug.to), source: "cleanup-suggestion" });
}

export function dismissSuggestion(doc: RevoiceDocument, segmentId: string, suggestionId: string): RevoiceDocument {
  return updateSegment(doc, segmentId, (s) =>
    s.check ? { ...s, check: { ...s.check, suggestions: (s.check.suggestions ?? []).filter((x) => x.id !== suggestionId) } } : s,
  );
}

/** Apply a review fix: replace `from` with `to` (or append when `from` is empty). */
export function applyTextFix(doc: RevoiceDocument, segmentId: string, from: string, to: string): RevoiceDocument {
  const seg = doc.segments.find((s) => s.id === segmentId);
  if (!seg) return doc;
  const text = currentText(seg) ?? seg.originalText;
  let next: string;
  if (!from) next = `${text} ${to}`;
  else if (text.includes(from)) next = text.replace(from, to);
  else return doc;
  next = next.replace(/\s+([,.!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return addRevision(doc, segmentId, { text: next, source: "review-fix" });
}
