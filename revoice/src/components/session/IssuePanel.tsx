"use client";

import { motion } from "motion/react";
import type { MeaningCheck, MeaningIssue } from "@/lib/types";
import { Button } from "@/components/ui/Button";

interface Props {
  check: MeaningCheck;
  issues: MeaningIssue[];
  onAdd(): void;
  onReviewOriginal(): void;
  onKeep(): void;
  onRedo(): void;
  showingOriginal: boolean;
}

function heading(issues: MeaningIssue[]): string {
  const changed = issues.some((i) => i.kind !== "missing_detail");
  if (issues.length === 1) return changed ? "This may say something different:" : "One detail may be missing:";
  return changed ? "A few things may differ:" : "A few details may be missing:";
}

/** Calm, inline notice shown when a rewrite may have lost or changed meaning. */
export function IssuePanel({ check, issues, onAdd, onReviewOriginal, onKeep, onRedo, showingOriginal }: Props) {
  return (
    <motion.div
      role="region"
      aria-label="Meaning check"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25 }}
      className="mx-auto w-full max-w-3xl px-4 sm:px-10"
      data-testid="issue-panel"
    >
      <div className="rounded-2xl border border-warn/25 bg-warn/[0.06] px-5 py-4">
        <p className="text-[13px] font-medium text-warn">{heading(issues)}</p>
        <ul className="mt-2 space-y-2">
          {issues.map((i) => (
            <li key={i.id} className="text-scaled">
              <p className="text-fg">{i.detail}</p>
              <p className="text-[13px] text-muted">{i.explanation}</p>
            </li>
          ))}
        </ul>
        {check.source === "heuristic" && (
          <p className="mt-2 text-[12px] text-faint">
            Offline check: only numbers, names, dates and negatives are compared. Keep your version if it already covers this.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={onAdd}>
            Add it in my own words <kbd className="ml-1 text-[11px] opacity-70">A</kbd>
          </Button>
          <Button size="sm" onClick={onReviewOriginal} aria-pressed={showingOriginal}>
            {showingOriginal ? "Hide details" : "Review original"}
          </Button>
          <Button size="sm" onClick={onKeep}>
            Keep my version <kbd className="ml-1 text-[11px] opacity-70">K</kbd>
          </Button>
          <Button variant="ghost" size="sm" onClick={onRedo}>
            Say it again
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** Non-blocking line for minor differences and cleanup suggestions. */
export function MinorNotes({
  check,
  onApplySuggestion,
  onDismissSuggestion,
}: {
  check: MeaningCheck;
  onApplySuggestion(id: string): void;
  onDismissSuggestion(id: string): void;
}) {
  const minor = check.issues.filter((i) => i.severity === "minor" && !i.resolution);
  const suggestions = check.suggestions ?? [];
  if (!minor.length && !suggestions.length) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-10">
      <div className="space-y-2 rounded-xl border border-line bg-surface/70 px-4 py-3 text-[13px]">
        {minor.map((i) => (
          <p key={i.id} className="text-muted">
            <span className="text-faint">Small difference: </span>
            {i.detail} {i.explanation}
          </p>
        ))}
        {suggestions.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 text-muted">
            <span className="text-faint">Suggestion:</span>
            <span className="line-through decoration-danger/60">{s.from}</span>
            <span aria-hidden="true">→</span>
            <span className="text-fg">{s.to}</span>
            <span className="text-faint">({s.reason})</span>
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onApplySuggestion(s.id)}>
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDismissSuggestion(s.id)}>
                Ignore
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
