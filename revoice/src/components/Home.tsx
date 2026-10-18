"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import type { DocumentSummary } from "@/lib/types";
import { getStore } from "@/lib/storage/store";
import { createDocument } from "@/lib/document/operations";
import { segmentDocument } from "@/lib/services/segmenter";
import { LIMITS } from "@/lib/api/contracts";
import { useAIActive, useServerStatus, useSettings } from "@/components/AppProviders";
import { webSpeechSupported } from "@/lib/speech";
import { Button } from "@/components/ui/Button";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SettingsIcon, TrashIcon } from "@/components/ui/Icons";

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function Home() {
  const router = useRouter();
  const { settings, update } = useSettings();
  const { status, reachable } = useServerStatus();
  const aiActive = useAIActive();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speechOk, setSpeechOk] = useState(true);

  useEffect(() => {
    void getStore().list().then(setDocs);
    setSpeechOk(webSpeechSupported());
  }, []);

  const start = async () => {
    const body = text.replace(/\r\n?/g, "\n");
    if (!body.trim() || busy) return;
    if (body.length > LIMITS.MAX_TEXT) {
      setError(`That's a long one — please keep it under ${LIMITS.MAX_TEXT.toLocaleString()} characters for now.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await segmentDocument(body, aiActive);
      if (!result.segments.length) throw new Error("No text found");
      const doc = createDocument(title, body, result.segments, result.source);
      await getStore().save(doc);
      router.push(`/session/${doc.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await getStore().delete(id);
    setDocs(await getStore().list());
    setConfirmId(null);
  };

  const inProgress = docs?.filter((d) => !d.completedAt) ?? [];
  const completed = docs?.filter((d) => d.completedAt) ?? [];
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-6 pb-24 pt-10 sm:px-10 sm:pt-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">R</span>
          <span className="text-lg font-semibold tracking-tight">Revoice</span>
        </div>
        <button type="button" aria-label="Settings" onClick={() => setSettingsOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg">
          <SettingsIcon />
        </button>
      </header>

      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mt-14">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight sm:text-5xl">Say it your way.</h1>
        <p className="mt-3 max-w-xl text-muted">
          Paste something that doesn’t sound like you. Read each idea, say it how you’d naturally say it, and Revoice keeps the meaning intact while
          the words stay yours.
        </p>
      </motion.section>

      <section className="mt-10" aria-label="New rewrite">
        <label htmlFor="doc-title" className="sr-only">
          Title
        </label>
        <input
          id="doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full border-0 bg-transparent px-0 py-2 text-lg font-medium text-fg placeholder:text-faint focus:outline-none"
          maxLength={120}
        />
        <label htmlFor="doc-text" className="sr-only">
          Text to rewrite
        </label>
        <textarea
          id="doc-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
          }}
          placeholder="Paste the email, message or essay you want to rewrite…"
          rows={10}
          className="text-scaled mt-2 w-full resize-y rounded-2xl border border-line bg-surface px-5 py-4 leading-relaxed text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          data-testid="doc-text"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void start()} disabled={!text.trim() || busy} data-testid="start-button" className="h-11 px-5">
            {busy ? "Finding the natural breaks…" : "Start rewriting"}
          </Button>
          <span className="text-[13px] text-faint">{words ? `${words} words` : "⌘↵ to start"}</span>
          <span className="flex-1" />
          <span className="text-[12px] text-faint" data-testid="ai-status">
            {!settings.aiEnabled
              ? "AI off · offline checks"
              : status === null && reachable
                ? "Checking AI…"
                : aiActive && reachable
                  ? `AI meaning checks on (${status?.model ?? "OpenAI"})`
                  : "AI unavailable · offline checks"}
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        {!speechOk && (
          <p className="mt-3 text-[13px] text-warn">
            This browser has no built-in speech recognition. Use Chrome, Edge or Safari
            {status?.transcription ? ", or choose OpenAI transcription in Settings" : ""}. You can also type your versions.
          </p>
        )}
        {!settings.privacyNoticeSeen && (
          <div className="mt-6 rounded-xl border border-line bg-surface/60 px-4 py-3 text-[13px] text-muted">
            <p>
              <span className="text-fg">Your text stays private.</span> Documents are saved only in this browser. When AI checking is on, each segment
              and your spoken version are sent to OpenAI to compare meaning. Speech is recognised by your browser (Chrome sends audio to Google) or by
              OpenAI if you choose it. Revoice keeps no recordings. You can turn AI off or delete everything in Settings.
            </p>
            <button type="button" className="mt-2 text-accent hover:underline" onClick={() => update({ privacyNoticeSeen: true })}>
              Got it
            </button>
          </div>
        )}
      </section>

      {inProgress.length > 0 && (
        <DocList title="Continue where you left off" docs={inProgress} confirmId={confirmId} setConfirmId={setConfirmId} onDelete={remove} />
      )}
      {completed.length > 0 && <DocList title="Finished" docs={completed} confirmId={confirmId} setConfirmId={setConfirmId} onDelete={remove} />}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

function DocList({
  title,
  docs,
  confirmId,
  setConfirmId,
  onDelete,
}: {
  title: string;
  docs: DocumentSummary[];
  confirmId: string | null;
  setConfirmId(id: string | null): void;
  onDelete(id: string): void;
}) {
  return (
    <section className="mt-14" aria-label={title}>
      <h2 className="text-[12px] uppercase tracking-wide text-faint">{title}</h2>
      <ul className="mt-3 divide-y divide-line/60 border-y border-line/60">
        {docs.map((d) => {
          const pct = d.segmentCount ? Math.round((d.doneCount / d.segmentCount) * 100) : 0;
          return (
            <li key={d.id} className="group flex items-center gap-4 py-3" data-testid="doc-row">
              <Link href={`/session/${d.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg group-hover:text-accent">{d.title}</p>
                <p className="mt-0.5 flex items-center gap-2 text-[12px] text-faint">
                  <span className="inline-block h-[3px] w-16 overflow-hidden rounded-full bg-line align-middle">
                    <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                  </span>
                  {d.completedAt ? "Done" : `${pct}% · ${d.doneCount}/${d.segmentCount}`} · {timeAgo(d.updatedAt)}
                </p>
              </Link>
              {confirmId === d.id ? (
                <span className="flex items-center gap-1 text-[13px]">
                  <Button variant="danger" size="sm" onClick={() => onDelete(d.id)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <>
                  <Link href={`/session/${d.id}`} className="text-[13px] text-muted hover:text-fg">
                    {d.completedAt ? "Open" : "Resume"}
                  </Link>
                  <button type="button" aria-label={`Delete ${d.title}`} onClick={() => setConfirmId(d.id)} className="rounded-full p-2 text-faint opacity-60 hover:bg-raised hover:text-danger group-hover:opacity-100">
                    <TrashIcon size={16} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
