"use client";

import { useState } from "react";
import type { RevoiceDocument } from "@/lib/types";
import { assembleParts } from "@/lib/document/reconstruct";

type View = "rewritten" | "original" | "compare";

export function PreviewView({ doc, onOpenSegment }: { doc: RevoiceDocument; onOpenSegment(id: string): void }) {
  const [view, setView] = useState<View>("rewritten");
  const parts = assembleParts(doc);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Preview mode" className="flex rounded-lg bg-surface p-0.5">
            {(
              [
                ["rewritten", "Rewritten"],
                ["original", "Original"],
                ["compare", "Side by side"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`h-8 rounded-md px-3 text-[13px] font-medium ${view === id ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "rewritten" && (
            <p className="text-[12px] text-faint">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-faint/60 align-middle" /> Greyed text hasn’t been rewritten yet. Click any
              part to open it.
            </p>
          )}
        </div>

        {view === "rewritten" && (
          <article className="text-scaled mt-8 max-w-2xl whitespace-pre-wrap leading-relaxed" data-testid="preview-rewritten">
            {parts.map((p) => (
              <span key={p.segmentId}>
                {p.separator}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenSegment(p.segmentId)}
                  onKeyDown={(e) => e.key === "Enter" && onOpenSegment(p.segmentId)}
                  className={`cursor-pointer rounded transition-colors hover:bg-raised ${p.origin === "original" ? "text-faint italic" : "text-fg"}`}
                  title={p.origin === "original" ? "Not rewritten yet — original wording" : "Your words"}
                >
                  {p.text}
                </span>
              </span>
            ))}
          </article>
        )}

        {view === "original" && (
          <article className="text-scaled mt-8 max-w-2xl whitespace-pre-wrap leading-relaxed text-muted">{doc.original.text}</article>
        )}

        {view === "compare" && (
          <div className="mt-8">
            <div className="grid grid-cols-2 gap-6 border-b border-line pb-2 text-[12px] uppercase tracking-wide text-faint">
              <span>Original</span>
              <span>Your version</span>
            </div>
            <ol>
              {doc.segments.map((s, i) => {
                const p = parts[i];
                const newPara = i > 0 && s.paragraphIndex !== doc.segments[i - 1].paragraphIndex;
                return (
                  <li
                    key={s.id}
                    className={`text-scaled grid cursor-pointer grid-cols-2 gap-6 rounded-lg py-2 hover:bg-surface ${newPara ? "mt-4" : ""}`}
                    onClick={() => onOpenSegment(s.id)}
                  >
                    <span className="text-muted">{s.originalText}</span>
                    <span className={p.origin === "original" ? "text-faint italic" : "text-fg"}>
                      {p.origin === "original" ? (s.status === "skipped" ? "(skipped — original kept)" : "—") : p.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </main>
  );
}
