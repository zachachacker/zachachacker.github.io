"use client";

import type { RevoiceDocument } from "@/lib/types";
import { mergeWithNext, splitSegment, validateSegmentation } from "@/lib/document/segmentation";
import { replaceSegments, currentText } from "@/lib/document/operations";
import { Button } from "@/components/ui/Button";
import { MergeIcon } from "@/components/ui/Icons";

/**
 * Merge and split segments. Click a gap between words to split there; use the
 * merge button between two segments to join them. Spans stay exact, and any
 * rewrite is kept in history.
 */
export function SegmentsEditor({
  doc,
  update,
  onClose,
}: {
  doc: RevoiceDocument;
  update(fn: (d: RevoiceDocument) => RevoiceDocument): void;
  onClose(): void;
}) {
  const text = doc.original.text;
  const apply = (fn: (segs: RevoiceDocument["segments"]) => RevoiceDocument["segments"]) =>
    update((d) => {
      const next = fn(d.segments);
      // Never accept an edit that would break the exact mapping to the source.
      if (next === d.segments || validateSegmentation(text, next).length) return d;
      return replaceSegments(d, next);
    });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Adjust segments</h2>
            <p className="mt-1 text-sm text-muted">
              Click between two words to split a segment there. Use <MergeIcon size={14} className="inline" /> to join a segment with the next one.
              Your wording is never lost: merged versions are joined, and split segments keep their history.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
        <ol className="mt-6 space-y-1">
          {doc.segments.map((s, i) => {
            const next = doc.segments[i + 1];
            const sameLine = next && !/\n/.test(text.slice(s.end, next.start));
            const words = s.originalText.split(/(\s+)/);
            let offset = 0;
            return (
              <li key={s.id}>
                <div className="rounded-xl border border-line bg-surface px-4 py-3" data-testid="segment-card">
                  <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint">
                    <span>Segment {i + 1}</span>
                    {currentText(s) && <span className="text-ok">· rewritten</span>}
                  </div>
                  <p className="text-scaled leading-relaxed">
                    {words.map((w, j) => {
                      const at = offset;
                      offset += w.length;
                      if (/^\s+$/.test(w)) {
                        return (
                          <button
                            key={j}
                            type="button"
                            aria-label={`Split before “${words[j + 1] ?? ""}”`}
                            onClick={() => apply((segs) => splitSegment(text, segs, s.id, at + w.length))}
                            className="mx-[1px] inline-block h-[1.2em] w-[0.5em] translate-y-[3px] rounded-sm align-baseline hover:bg-accent/60 focus-visible:bg-accent/60"
                          />
                        );
                      }
                      return <span key={j}>{w}</span>;
                    })}
                  </p>
                </div>
                {next && (
                  <div className="flex justify-center py-1">
                    <button
                      type="button"
                      onClick={() => apply((segs) => mergeWithNext(text, segs, s.id))}
                      disabled={!sameLine}
                      title={sameLine ? "Merge with next" : "Segments on different lines can't be merged"}
                      aria-label={`Merge segment ${i + 1} with segment ${i + 2}`}
                      className="flex h-7 items-center gap-1 rounded-full px-3 text-[12px] text-faint hover:bg-raised hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <MergeIcon size={14} /> merge
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}
