"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { ReviewFinding, RevoiceDocument } from "@/lib/types";
import { applyCheck, applyTextFix, currentText, progress } from "@/lib/document/operations";
import { assembleRewritten } from "@/lib/document/reconstruct";
import { hashText } from "@/lib/id";
import { checkSegment, reviewDocument } from "@/lib/services/checker";
import { useAIActive, useSettings } from "@/components/AppProviders";
import { Button } from "@/components/ui/Button";

interface Props {
  doc: RevoiceDocument;
  get(): RevoiceDocument | null;
  update(fn: (d: RevoiceDocument) => RevoiceDocument): void;
  onOpenSegment(id: string): void;
  onExport(): void;
}

const KIND_LABEL: Record<ReviewFinding["kind"], string> = {
  missing_information: "Missing information",
  repetition: "Repeated",
  contradiction: "Contradiction",
  broken_transition: "Transition",
  unclear_reference: "Unclear reference",
  meaning_change: "Meaning changed",
  commitment_change: "Commitment changed",
  optional_improvement: "Optional improvement",
};

export function ReviewView({ doc, get, update, onOpenSegment, onExport }: Props) {
  const aiActive = useAIActive();
  const { settings } = useSettings();
  const [running, setRunning] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const autoRan = useRef(false);

  const currentHash = hashText(assembleRewritten(doc));
  const stale = !!doc.review && doc.review.basedOn !== currentHash;
  const prog = progress(doc);

  const run = useCallback(async () => {
    const d = get();
    if (!d) return;
    setRunning(true);
    const { review, fallback } = await reviewDocument(d, aiActive);
    setFallback(fallback ?? null);
    update((x) => ({ ...x, review }));
    setRunning(false);
  }, [aiActive, get, update]);

  // Run automatically the first time the review is opened with no result.
  useEffect(() => {
    if (!doc.review && !autoRan.current) {
      autoRan.current = true;
      void run();
    }
  }, [doc.review, run]);

  const setStatus = (id: string, status: ReviewFinding["status"]) =>
    update((x) => (x.review ? { ...x, review: { ...x.review, findings: x.review.findings.map((f) => (f.id === id ? { ...f, status } : f)) } } : x));

  const applyFix = async (f: ReviewFinding) => {
    if (!f.fix) return;
    const { segmentId, from, to } = f.fix;
    update((x) => applyTextFix(x, segmentId, from, to));
    setStatus(f.id, "applied");
    // Re-check that segment's meaning with the new wording.
    const d = get();
    const seg = d?.segments.find((s) => s.id === segmentId);
    const text = seg ? currentText(seg) : null;
    if (d && text) {
      const o = await checkSegment(d, segmentId, text, { aiEnabled: aiActive, cleanup: settings.cleanup });
      update((x) => applyCheck(x, segmentId, o.check));
    }
  };

  const findings = doc.review?.findings ?? [];
  const meaning = findings.filter((f) => f.category === "meaning");
  const optional = findings.filter((f) => f.category === "optional");
  const attention = doc.segments.filter((s) => s.status !== "completed");

  const renderFinding = (f: ReviewFinding) => {
    const segs = f.segmentIds.map((id) => doc.segments.find((s) => s.id === id)).filter(Boolean);
    const fixSeg = f.fix ? doc.segments.find((s) => s.id === f.fix!.segmentId) : null;
    return (
      <motion.li
        key={f.id}
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: f.status === "open" ? 1 : 0.5, y: 0 }}
        className="rounded-xl border border-line bg-surface p-4"
        data-testid="finding"
      >
        <div className="flex items-center gap-2 text-[12px]">
          <span className={`rounded px-1.5 py-0.5 font-medium ${f.category === "meaning" ? "bg-warn/10 text-warn" : "bg-accent-soft text-accent"}`}>
            {KIND_LABEL[f.kind]}
          </span>
          {f.status !== "open" && <span className="text-faint">{f.status === "applied" ? "Applied" : "Dismissed"}</span>}
        </div>
        <p className="text-scaled mt-2 text-fg">{f.explanation}</p>
        {segs.length > 0 && (
          <div className="mt-3 space-y-2">
            {segs.map((s) => (
              <button
                key={s!.id}
                type="button"
                onClick={() => onOpenSegment(s!.id)}
                className="grid w-full grid-cols-1 gap-1 rounded-lg border border-line/70 px-3 py-2 text-left text-[13px] hover:border-faint sm:grid-cols-2 sm:gap-4"
              >
                <span className="text-muted">
                  <span className="mr-1 text-faint">Original:</span>
                  {s!.originalText}
                </span>
                <span className="text-fg">
                  <span className="mr-1 text-faint">Yours:</span>
                  {currentText(s!) ?? "—"}
                </span>
              </button>
            ))}
          </div>
        )}
        {f.fix && fixSeg && f.status === "open" && (
          <div className="mt-3 rounded-lg bg-bg px-3 py-2 text-[13px]">
            <span className="text-faint">Suggested change: </span>
            {f.fix.from ? (
              <>
                <span className="text-muted line-through decoration-danger/60">{f.fix.from}</span>
                {f.fix.to && (
                  <>
                    {" "}
                    → <span className="text-fg">{f.fix.to}</span>
                  </>
                )}
              </>
            ) : (
              <>
                add <span className="text-fg">“{f.fix.to}”</span>
              </>
            )}
          </div>
        )}
        {f.status === "open" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {f.fix && (
              <Button size="sm" variant="primary" onClick={() => void applyFix(f)}>
                Apply change
              </Button>
            )}
            {(f.fix?.segmentId ?? f.segmentIds[0]) && (
              <Button size="sm" onClick={() => onOpenSegment(f.fix?.segmentId ?? f.segmentIds[0])}>
                Fix it myself
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, "dismissed")}>
              {f.category === "meaning" ? "It’s fine as is" : "Dismiss"}
            </Button>
          </div>
        )}
      </motion.li>
    );
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Final review</h2>
            <p className="mt-1 text-sm text-muted">
              Checks the whole document against the original: missing details, repeats, contradictions and changed meaning.
              Nothing is changed unless you approve it.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void run()} disabled={running}>
              {running ? "Reviewing…" : doc.review ? "Run again" : "Run review"}
            </Button>
            <Button size="sm" variant="primary" onClick={onExport}>
              Export
            </Button>
          </div>
        </div>

        {doc.review && (
          <p className="mt-3 text-[12px] text-faint">
            {doc.review.source === "ai" ? "AI review" : "Offline review (numbers, names, dates, repeats and open issues only)"}
            {" · "}
            {new Date(doc.review.createdAt).toLocaleTimeString()}
            {stale && <span className="text-warn"> · Your text changed since this review — run it again to update.</span>}
            {fallback && <span> · AI unavailable ({fallback})</span>}
          </p>
        )}

        {prog.done < prog.total && (
          <section className="mt-6 rounded-xl border border-line p-4">
            <h3 className="text-sm font-medium">
              {attention.length} segment{attention.length === 1 ? "" : "s"} still need attention
            </h3>
            <ul className="mt-2 space-y-1">
              {attention.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpenSegment(s.id)} className="text-left text-[13px] text-muted hover:text-fg">
                    <span className={s.status === "flagged" ? "text-warn" : "text-faint"}>{s.status === "flagged" ? "Check" : "Not done"}</span> ·{" "}
                    {s.originalText}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {running && !doc.review && <p className="mt-10 text-center text-sm text-muted">Reading your whole document…</p>}

        {doc.review && (
          <>
            <section className="mt-8">
              <h3 className="text-sm font-medium text-fg">Meaning differences</h3>
              {meaning.length === 0 ? (
                <p className="mt-2 text-sm text-ok" data-testid="review-clean">
                  No meaning differences found. Your version says what the original says.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">{meaning.map(renderFinding)}</ul>
              )}
            </section>
            {optional.length > 0 && (
              <section className="mt-8">
                <h3 className="text-sm font-medium text-fg">Optional improvements</h3>
                <p className="mt-1 text-[13px] text-faint">Not problems — take them or leave them.</p>
                <ul className="mt-3 space-y-3">{optional.map(renderFinding)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
