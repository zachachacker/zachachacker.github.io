"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";

interface Props {
  original: string;
  initial: string;
  rawTranscript?: string;
  onSave(text: string): void;
  onCancel(): void;
}

/** Manual correction of a transcript, or typing a version instead of speaking. */
export function EditSheet({ original, initial, rawTranscript, onSave, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-3xl px-4 sm:px-10"
      role="dialog"
      aria-label="Edit your version"
    >
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-[12px] uppercase tracking-wide text-faint">Original</p>
        <p className="text-scaled mt-1 text-muted">{original}</p>
        <label htmlFor="edit-rewrite" className="mt-4 block text-[12px] uppercase tracking-wide text-faint">
          Your version
        </label>
        <textarea
          id="edit-rewrite"
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (text.trim()) onSave(text.trim());
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          rows={3}
          className="text-scaled mt-1 w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          placeholder="Type how you'd say it…"
          data-testid="edit-textarea"
        />
        {rawTranscript && rawTranscript !== initial && (
          <p className="mt-1 text-[12px] text-faint">Heard as: “{rawTranscript}”</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!text.trim()} onClick={() => onSave(text.trim())}>
            Save <kbd className="ml-1 text-[11px] opacity-70">⌘↵</kbd>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
