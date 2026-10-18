"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { RevoiceDocument, Segment } from "@/lib/types";
import { currentText } from "@/lib/document/operations";
import { CheckIcon } from "@/components/ui/Icons";
import { useReducedMotion, useSettings } from "@/components/AppProviders";

export type FlowPhase = "idle" | "checking" | "accepted" | "issue" | "editing";

interface Props {
  doc: RevoiceDocument;
  activeId: string | null;
  phase: FlowPhase;
  showDetails: boolean;
  onSelect(id: string): void;
}

const CONCRETE = new Set(["number", "date", "name"]);

function lineOpacity(distance: number, seg: Segment): number {
  if (distance === 0) return 1;
  const done = seg.status === "completed" || seg.status === "skipped";
  const base = Math.abs(distance) === 1 ? 0.46 : Math.abs(distance) === 2 ? 0.3 : 0.18;
  // Completed segments recede a little further as the user moves on.
  return distance < 0 && done ? base * 0.8 : base;
}

export function LyricsView({ doc, activeId, phase, showDetails, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLDivElement>());
  const [y, setY] = useState(0);
  const reduce = useReducedMotion();
  const { settings } = useSettings();

  const activeIndex = doc.segments.findIndex((s) => s.id === activeId);

  const recenter = useCallback(() => {
    const c = containerRef.current;
    const el = activeId ? items.current.get(activeId) : null;
    if (!c || !el) return;
    setY(c.clientHeight * 0.44 - (el.offsetTop + el.offsetHeight / 2));
  }, [activeId]);

  useLayoutEffect(() => {
    recenter();
  }, [recenter, doc, phase, showDetails, settings.fontScale]);

  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => recenter());
    ro.observe(c);
    return () => ro.disconnect();
  }, [recenter]);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden"
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 16%, black 80%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 16%, black 80%, transparent 100%)",
      }}
    >
      <motion.ol
        className="absolute inset-x-0 top-0 mx-auto w-full max-w-3xl px-4 sm:px-10"
        initial={false}
        animate={{ y }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 110, damping: 21, mass: 0.9 }}
        aria-label="Original text, one idea at a time"
      >
        {doc.segments.map((seg, i) => {
          const distance = i - activeIndex;
          const active = distance === 0;
          const newParagraph = i > 0 && seg.paragraphIndex !== doc.segments[i - 1].paragraphIndex;
          const rewrite = currentText(seg);
          const done = seg.status === "completed";
          const keyDetails = seg.keyPoints.filter((k) => CONCRETE.has(k.kind));
          return (
            <li
              key={seg.id}
              ref={(el) => {
                if (el) items.current.set(seg.id, el as unknown as HTMLDivElement);
                else items.current.delete(seg.id);
              }}
              className={newParagraph ? "pt-10" : "pt-5"}
              data-testid={active ? "active-segment" : undefined}
              data-segment-id={seg.id}
              data-status={seg.status}
            >
              <motion.div
                role="button"
                tabIndex={active ? -1 : 0}
                aria-current={active ? "step" : undefined}
                aria-label={`${active ? "Current" : "Go to"} segment ${i + 1}: ${seg.originalText}`}
                onClick={() => !active && onSelect(seg.id)}
                onKeyDown={(e) => {
                  if (!active && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect(seg.id);
                  }
                }}
                initial={false}
                animate={{
                  opacity: lineOpacity(distance, seg),
                  scale: active ? 1 : 0.94,
                  filter: reduce || Math.abs(distance) < 2 ? "blur(0px)" : "blur(0.6px)",
                }}
                transition={{ duration: reduce ? 0 : 0.45, ease: [0.2, 0.7, 0.2, 1] }}
                style={{ transformOrigin: "left center" }}
                className={`group relative rounded-xl outline-none ${active ? "" : "cursor-pointer hover:!opacity-80"}`}
              >
                <p className={`lyric ${active ? "text-fg" : "text-fg"}`}>
                  {seg.originalText}
                  <AnimatePresence>
                    {active && phase === "accepted" && (
                      <motion.span
                        key="ok"
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                        className="ml-3 inline-flex h-8 w-8 translate-y-[-2px] items-center justify-center rounded-full bg-ok/15 align-middle text-ok"
                        aria-hidden="true"
                      >
                        <CheckIcon size={18} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </p>

                {/* The user's own version, shown under completed lines. */}
                {rewrite && !active && (
                  <p className="text-scaled mt-1.5 flex items-start gap-2 text-muted">
                    <span className={`mt-[3px] shrink-0 ${done ? "text-ok" : "text-warn"}`} aria-hidden="true">
                      {done ? <CheckIcon size={14} /> : "•"}
                    </span>
                    <span>{rewrite}</span>
                  </p>
                )}
                {!rewrite && seg.status === "skipped" && !active && (
                  <p className="text-scaled mt-1.5 text-faint">Skipped — original wording will be used</p>
                )}

                {active && (keyDetails.length > 0 || showDetails) && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-scaled mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted"
                  >
                    <span className="mr-1 text-faint">Keep:</span>
                    {(showDetails ? seg.keyPoints : keyDetails).map((k, j) => (
                      <span key={j} className="rounded-md border border-line bg-surface px-2 py-0.5">
                        {k.text}
                      </span>
                    ))}
                    {showDetails && seg.keyPoints.length === 0 && <span>No specific details flagged.</span>}
                  </motion.div>
                )}
              </motion.div>
            </li>
          );
        })}
        <li aria-hidden="true" className="h-[60vh]" />
      </motion.ol>
    </div>
  );
}
