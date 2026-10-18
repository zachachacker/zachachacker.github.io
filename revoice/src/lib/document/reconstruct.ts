/**
 * Rebuilds a document from its segments. Spacing between segments is taken
 * from the original text, so paragraph breaks, single line breaks (e.g. a
 * sign-off) and blank lines all survive exactly as they were.
 */

import type { RevoiceDocument, Segment } from "../types";
import { currentText } from "./operations";

export interface AssembledPart {
  segmentId: string;
  /** Whitespace that precedes this segment in the output. */
  separator: string;
  text: string;
  /** "rewritten" = the user's words; "original" = fallback because the segment isn't done. */
  origin: "rewritten" | "original";
}

function separatorFromGap(gap: string): string {
  const newlines = (gap.match(/\n/g) ?? []).length;
  if (newlines >= 2) return "\n\n";
  if (newlines === 1) return "\n";
  return " ";
}

export function segmentOutput(seg: Segment): { text: string; origin: AssembledPart["origin"] } {
  const t = seg.status === "skipped" ? null : currentText(seg);
  return t !== null && t.trim() ? { text: t.trim(), origin: "rewritten" } : { text: seg.originalText, origin: "original" };
}

export function assembleParts(doc: RevoiceDocument): AssembledPart[] {
  const text = doc.original.text;
  return doc.segments.map((seg, i) => {
    const prevEnd = i === 0 ? 0 : doc.segments[i - 1].end;
    const separator = i === 0 ? "" : separatorFromGap(text.slice(prevEnd, seg.start));
    return { segmentId: seg.id, separator, ...segmentOutput(seg) };
  });
}

/** The rewritten document assembled from segments (pending/skipped segments fall back to the original). */
export function assembleRewritten(doc: RevoiceDocument): string {
  return assembleParts(doc).map((p) => p.separator + p.text).join("");
}

/** What the user exports: their whole-document edit if they made one, else the assembled text. */
export function finalText(doc: RevoiceDocument): string {
  return doc.finalEdit?.text ?? assembleRewritten(doc);
}

/** True when segments changed after the user edited the whole document. */
export function isFinalEditStale(doc: RevoiceDocument): boolean {
  if (!doc.finalEdit) return false;
  return doc.segments.some((s) => s.updatedAt > doc.finalEdit!.editedAt);
}

export function toMarkdown(title: string, body: string): string {
  // Single newlines inside a paragraph need a hard break in Markdown.
  const paragraphs = body.split(/\n{2,}/).map((p) => p.split("\n").join("  \n"));
  return `# ${title}\n\n${paragraphs.join("\n\n")}\n`;
}

export function toPlainText(body: string): string {
  return body.endsWith("\n") ? body : body + "\n";
}

export function fileSafeName(title: string): string {
  return title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "revoice";
}
