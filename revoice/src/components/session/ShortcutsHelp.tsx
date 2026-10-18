"use client";

import { CloseIcon } from "@/components/ui/Icons";
import { IconButton } from "@/components/ui/Button";

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Start / pause the microphone"],
  ["Enter", "Done with this segment"],
  ["↑ / ←", "Previous segment"],
  ["↓ / →", "Next segment"],
  ["R", "Redo the current segment"],
  ["E", "Edit or type your version"],
  ["U  or  ⌘/Ctrl Z", "Undo to the previous version"],
  ["O", "Use the original wording"],
  ["S", "Skip this segment"],
  ["A", "Add a missing detail (when flagged)"],
  ["K", "Keep my version (when flagged)"],
  ["D", "Show the details to keep"],
  ["Esc", "Pause / close"],
  ["?", "This help"],
];

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Keyboard shortcuts</h2>
          <IconButton label="Close" onClick={onClose} autoFocus>
            <CloseIcon />
          </IconButton>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 text-[12px]">{k}</kbd>
              </dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
