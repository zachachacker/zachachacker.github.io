"use client";

import { useState } from "react";
import Link from "next/link";
import type { RevoiceDocument } from "@/lib/types";
import { assembleRewritten, fileSafeName, finalText, isFinalEditStale, toMarkdown, toPlainText } from "@/lib/document/reconstruct";
import { nowISO } from "@/lib/id";
import { progress } from "@/lib/document/operations";
import { Button } from "@/components/ui/Button";
import { CheckIcon, CopyIcon, DownloadIcon } from "@/components/ui/Icons";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function ExportView({ doc, update, onBack }: { doc: RevoiceDocument; update(fn: (d: RevoiceDocument) => RevoiceDocument): void; onBack(): void }) {
  const text = finalText(doc);
  const [copied, setCopied] = useState(false);
  const stale = isFinalEditStale(doc);
  const prog = progress(doc);
  const openFindings = doc.review?.findings.filter((f) => f.status === "open" && f.category === "meaning").length ?? 0;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              if (await copyText(text)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }
            }}
            data-testid="copy-button"
          >
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied ? "Copied" : "Copy text"}
          </Button>
          <Button onClick={() => download(`${fileSafeName(doc.title)}.txt`, toPlainText(text), "text/plain;charset=utf-8")}>
            <DownloadIcon size={16} /> .txt
          </Button>
          <Button onClick={() => download(`${fileSafeName(doc.title)}.md`, toMarkdown(doc.title, text), "text/markdown;charset=utf-8")}>
            <DownloadIcon size={16} /> .md
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onBack}>
            Back to editing
          </Button>
          <Link href="/" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-muted hover:bg-raised hover:text-fg">
            New session
          </Link>
        </div>

        {(prog.done < prog.total || openFindings > 0) && (
          <p className="mt-4 text-[13px] text-warn">
            {prog.done < prog.total && `${prog.total - prog.done} segment(s) still use the original wording. `}
            {openFindings > 0 && `${openFindings} review finding(s) are still open.`}
          </p>
        )}
        {stale && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 px-3 py-2 text-[13px] text-warn">
            You changed segments after editing the full text below.
            <Button size="sm" onClick={() => update((d) => ({ ...d, finalEdit: null }))}>
              Use the updated segments
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update((d) => (d.finalEdit ? { ...d, finalEdit: { ...d.finalEdit, editedAt: nowISO() } } : d))}>
              Keep my edits
            </Button>
          </div>
        )}

        <label htmlFor="final-text" className="mt-6 block text-[12px] uppercase tracking-wide text-faint">
          Your document {doc.finalEdit ? "(edited)" : ""}
        </label>
        <textarea
          id="final-text"
          data-testid="final-text"
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            update((d) => ({ ...d, finalEdit: v === assembleRewritten(d) ? null : { text: v, editedAt: nowISO() } }));
          }}
          className="text-scaled mt-2 min-h-[50vh] w-full resize-y rounded-xl border border-line bg-surface px-5 py-4 leading-relaxed text-fg outline-none focus:border-accent"
        />
        <p className="mt-2 text-[12px] text-faint">
          Edits here change only the final text, not your segments. The original is always kept separately.
          {doc.finalEdit && (
            <button type="button" className="ml-2 text-accent hover:underline" onClick={() => update((d) => ({ ...d, finalEdit: null }))}>
              Discard edits
            </button>
          )}
        </p>
      </div>
    </main>
  );
}
