"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { RevoiceDocument, Segment } from "@/lib/types";
import {
  addRevision, applyCheck, applySuggestion, canUndo, currentRevision, currentText, dismissSuggestion, isCheckStale,
  keepMyVersion, keepOriginal, nextOpenSegment, progress, setActive, skipSegment, undoRevision, unresolvedImportantIssues,
} from "@/lib/document/operations";
import { joinSpoken, minimalCleanup } from "@/lib/meaning/cleanup";
import { checkSegment } from "@/lib/services/checker";
import { resolveProviderId, providerMeta, SpeechError, simulatedSpeechEnabled } from "@/lib/speech";
import { useAIActive, useServerStatus, useSettings } from "@/components/AppProviders";
import { useDocument } from "./useDocument";
import { useSpeech, type UtteranceContext } from "./useSpeech";
import { LyricsView, type FlowPhase } from "./LyricsView";
import { RecorderDock } from "./RecorderDock";
import { IssuePanel, MinorNotes } from "./IssuePanel";
import { EditSheet } from "./EditSheet";
import { PreviewView } from "./PreviewView";
import { ReviewView } from "./ReviewView";
import { ExportView } from "./ExportView";
import { SegmentsEditor } from "./SegmentsEditor";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { AlertIcon, ChevronLeft, CloseIcon, PauseIcon, SettingsIcon } from "@/components/ui/Icons";
import { IconButton } from "@/components/ui/Button";

export type Mode = "rewrite" | "preview" | "review" | "export" | "segments";

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "rewrite", label: "Rewrite" },
  { id: "preview", label: "Preview" },
  { id: "review", label: "Review" },
  { id: "export", label: "Export" },
];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function SessionScreen({ id }: { id: string }) {
  const { doc, get, update, loadError, saveError } = useDocument(id);
  const { settings } = useSettings();
  const { reachable } = useServerStatus();
  const speechRef = useRef<ReturnType<typeof useSpeech> | null>(null);
  const aiActive = useAIActive();

  const [mode, setMode] = useState<Mode>("rewrite");
  const [phase, setPhase] = useState<FlowPhase>("idle");
  /** The user's intent for the mic to be on (hands-free across segments). */
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState<{ segmentId: string; text: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<SpeechError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announce, setAnnounce] = useState("");

  const advanceTimer = useRef<number | null>(null);
  const nextModeRef = useRef<UtteranceContext["mode"]>("replace");
  const armedBeforeEdit = useRef(false);
  /** Increments whenever the user moves; async results for an old position are ignored for flow purposes. */
  const flowToken = useRef(0);

  const { status } = useServerStatus();
  const providerId = useMemo(() => resolveProviderId(settings), [settings]);
  // Browser recognition for live words + OpenAI for the final text, when available.
  const refine = providerId === "webspeech" && settings.refineTranscripts && aiActive && status?.transcription === true;
  const providerInfo = useMemo(() => providerMeta(providerId, { refine }), [providerId, refine]);

  const active: Segment | null = doc?.segments.find((s) => s.id === doc.activeSegmentId) ?? null;
  const activeIndex = doc && active ? doc.segments.indexOf(active) : -1;

  const clearAdvance = () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };

  // ---------------------------------------------------------------------------
  // Checking and progression
  // ---------------------------------------------------------------------------

  const goToNextOpen = useCallback(() => {
    const d = get();
    if (!d) return;
    // The user started talking again about this line: stay (onResume handles it).
    if (speechRef.current?.hasNewWords()) return;
    speechRef.current?.cancel();
    const next = nextOpenSegment(d, d.activeSegmentId);
    flowToken.current++;
    setShowDetails(false);
    if (next) {
      update((x) => setActive(x, next.id));
      setPhase("idle");
    } else {
      // Everything is done: stop listening and move to the whole-document review.
      setArmed(false);
      setPhase("idle");
      setMode("review");
      setAnnounce("All segments are done. Running the final review.");
    }
  }, [get, update]);

  const runCheck = useCallback(
    async (segmentId: string, text: string, opts: { advance: boolean }) => {
      const token = flowToken.current;
      const isActive = get()?.activeSegmentId === segmentId;
      if (isActive) setPhase("checking");
      const d = get();
      if (!d) return;
      const outcome = await checkSegment(d, segmentId, text, { aiEnabled: aiActive, cleanup: settings.cleanup });
      update((x) => applyCheck(x, segmentId, outcome.check));
      if (outcome.fallback) {
        setNotice(
          outcome.fallback === "unavailable"
            ? "AI checking isn't configured, so an offline check was used (numbers, names, dates, negatives)."
            : "Couldn't reach the AI, so an offline check was used. A full check will run automatically when you're back online.",
        );
      }
      if (token !== flowToken.current || get()?.activeSegmentId !== segmentId) return; // user moved on
      const seg = get()?.segments.find((s) => s.id === segmentId);
      if (!seg || currentText(seg) !== text) return;
      if (seg.status === "completed") {
        if (!opts.advance) {
          // A background re-check (e.g. after undo) shouldn't interrupt the flow.
          setPhase("idle");
          return;
        }
        setPhase("accepted");
        setAnnounce("Accepted.");
        if (settings.autoProgress) {
          clearAdvance();
          advanceTimer.current = window.setTimeout(goToNextOpen, settings.transitionDelayMs);
        }
      } else {
        setPhase("issue");
        const issues = unresolvedImportantIssues(seg);
        setAnnounce(`Possible difference: ${issues.map((i) => i.detail).join(" ")}`);
      }
    },
    [aiActive, get, goToNextOpen, settings.autoProgress, settings.cleanup, settings.transitionDelayMs, update],
  );

  const saveVersion = useCallback(
    (segmentId: string, raw: string, source: "speech" | "speech-append" | "edit" | "typed", advance: boolean) => {
      const d = get();
      const seg = d?.segments.find((s) => s.id === segmentId);
      if (!d || !seg) return;
      // An addition is joined to what was said before, as one piece of speech.
      const prev = currentRevision(seg);
      const rawFull = source === "speech-append" && prev ? joinSpoken(prev.rawTranscript ?? prev.text, raw) : raw;
      const text = minimalCleanup(rawFull, { removeFillers: settings.removeFillers, original: seg.originalText });
      if (!text) return;
      update((x) => addRevision(x, segmentId, { text, rawTranscript: source.startsWith("speech") ? rawFull : undefined, source }));
      void runCheck(segmentId, text, { advance });
    },
    [get, runCheck, settings.removeFillers, update],
  );

  // ---------------------------------------------------------------------------
  // Speech
  // ---------------------------------------------------------------------------

  const speech = useSpeech({
    providerId,
    refine,
    language: settings.speechLanguage,
    silenceMs: settings.silenceMs,
    adaptive: settings.adaptiveSilence,
    onUtterance: (text, raw, ctx) => {
      setDraft(null);
      saveVersion(ctx.segmentId, raw, ctx.mode === "append" ? "speech-append" : "speech", true);
    },
    onEmpty: (ctx) => {
      // Nothing heard. A fresh utterance restarts; a continuation just resumes waiting (the phase is unchanged).
      if (!ctx.continuation) setPhase("idle");
    },
    onResume: (ctx) => {
      // Still talking about this line after we thought they'd finished: hold the line, cancel the pending
      // check/advance, and let the new words join the same segment.
      if (get()?.activeSegmentId !== ctx.segmentId) return;
      clearAdvance();
      flowToken.current++;
      setPhase("idle");
      setAnnounce("Still listening to this line.");
    },
    onError: (err) => {
      setSpeechError(err);
      setArmed(false);
      setPhase("idle");
    },
  });
  speechRef.current = speech;

  // Keep the mic open whenever it is armed:
  //  - idle: a fresh utterance for the active line;
  //  - while checking, after acceptance, or while a note is shown: a continuation, so if the
  //    user keeps talking their words are added to this line instead of being lost or landing
  //    on the next one.
  useEffect(() => {
    if (!doc || !active || mode !== "rewrite" || !armed || speech.state !== "off") return;
    const hints = active.keyPoints.filter((k) => k.kind === "name").map((k) => k.text);
    if (phase === "idle") {
      const ctx: UtteranceContext = { segmentId: active.id, mode: nextModeRef.current };
      nextModeRef.current = "replace";
      const prefix = draft?.segmentId === active.id ? draft.text : "";
      setSpeechError(null);
      void speech.start(ctx, { hints }, prefix);
    } else if (phase === "checking" || phase === "accepted" || phase === "issue") {
      const rev = currentRevision(active);
      if (!rev || rev.source === "kept-original") return;
      // Continue from the raw words, not the punctuated version, so a carried-on sentence stays one sentence.
      void speech.start({ segmentId: active.id, mode: "replace", continuation: true }, { hints }, rev.rawTranscript ?? rev.text);
    }
  }, [doc, active, mode, armed, phase, speech, draft]);

  // Leaving the rewrite view or disarming stops the mic, keeping any words said so far.
  useEffect(() => {
    if ((mode !== "rewrite" || !armed) && speech.state !== "off" && speech.state !== "finishing") {
      void speech.pause().then(({ text, hasNew, ctx }) => {
        if (hasNew && ctx) setDraft({ segmentId: ctx.segmentId, text });
      });
    }
  }, [mode, armed, speech]);

  useEffect(() => () => speech.release(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Background re-checks (stale after undo/merge, or offline results when back online)
  // ---------------------------------------------------------------------------

  const recheckBusy = useRef(false);
  useEffect(() => {
    if (!doc || recheckBusy.current || phase === "checking") return;
    const target = doc.segments.find(
      (s) =>
        s.id !== doc.activeSegmentId &&
        currentText(s) !== null &&
        (isCheckStale(s) || (s.check?.needsRecheck && aiActive && reachable && navigator.onLine)),
    );
    if (!target) return;
    recheckBusy.current = true;
    const text = currentText(target)!;
    void checkSegment(doc, target.id, text, { aiEnabled: aiActive, cleanup: settings.cleanup })
      .then((o) => {
        // Don't loop on a failed recheck: keep the old result if the AI is still unreachable.
        if (o.fallback && !isCheckStale(target)) return;
        update((x) => applyCheck(x, target.id, o.check));
      })
      .finally(() => {
        recheckBusy.current = false;
      });
  }, [doc, phase, aiActive, reachable, settings.cleanup, update]);

  // Stale check on the active segment (e.g. after undo): check it, without advancing.
  useEffect(() => {
    if (!active || phase !== "idle" || speech.state !== "off") return;
    if (isCheckStale(active)) void runCheck(active.id, currentText(active)!, { advance: false });
  }, [active, phase, speech.state, runCheck]);

  // ---------------------------------------------------------------------------
  // User actions
  // ---------------------------------------------------------------------------

  const goTo = useCallback(
    async (segmentId: string) => {
      const d = get();
      if (!d || d.activeSegmentId === segmentId) return;
      clearAdvance();
      flowToken.current++;
      // Never lose words: anything said for the old segment is saved to it.
      if (speech.state !== "off") {
        const { text, hasNew, ctx } = await speech.pause();
        if (hasNew && ctx) saveVersion(ctx.segmentId, text, ctx.mode === "append" ? "speech-append" : "speech", false);
      }
      speech.clearPartial();
      setDraft(null);
      setShowDetails(false);
      nextModeRef.current = "replace";
      update((x) => setActive(x, segmentId));
      setPhase("idle");
      setMode("rewrite");
      const i = get()!.segments.findIndex((s) => s.id === segmentId);
      setAnnounce(`Segment ${i + 1} of ${get()!.segments.length}: ${get()!.segments[i].originalText}`);
    },
    [get, saveVersion, speech, update],
  );

  const move = useCallback(
    (delta: number) => {
      const d = get();
      if (!d) return;
      const i = d.segments.findIndex((s) => s.id === d.activeSegmentId);
      const next = d.segments[i + delta];
      if (next) void goTo(next.id);
    },
    [get, goTo],
  );

  const toggleMic = useCallback(() => {
    if (phase === "editing") return;
    if (armed) {
      setArmed(false);
      return;
    }
    setSpeechError(null);
    setArmed(true);
  }, [armed, phase]);

  const done = useCallback(() => {
    // Mid-sentence: finish it now (it is then checked as usual).
    if (speech.hasNewWords()) {
      void speech.finish();
      return;
    }
    const d = get();
    const seg = d?.segments.find((s) => s.id === d.activeSegmentId);
    if (!seg) return;
    if (!currentText(seg)) {
      if (speech.state === "listening" || speech.state === "hearing") void speech.finish();
      return;
    }
    // "I'm done with this line": accept it as it stands and move on.
    clearAdvance();
    if (seg.status !== "completed") update((x) => keepMyVersion(x, seg.id));
    goToNextOpen();
  }, [get, goToNextOpen, speech, update]);

  const redo = useCallback(() => {
    clearAdvance();
    flowToken.current++;
    speech.cancel();
    setDraft(null);
    nextModeRef.current = "replace";
    setPhase("idle");
    setArmed(true);
  }, [speech]);

  const undo = useCallback(() => {
    if (!active) return;
    clearAdvance();
    flowToken.current++;
    update((x) => undoRevision(x, active.id));
    setPhase("idle");
  }, [active, update]);

  const openEditor = useCallback(async () => {
    if (!active) return;
    clearAdvance();
    flowToken.current++;
    armedBeforeEdit.current = armed;
    let kept = "";
    if (speech.state !== "off") {
      const r = await speech.pause();
      if (r.hasNew) kept = r.text;
    }
    setArmed(false);
    if (kept) setDraft({ segmentId: active.id, text: kept });
    setPhase("editing");
  }, [active, armed, speech]);

  const keepOriginalWording = useCallback(() => {
    if (!active) return;
    clearAdvance();
    speech.cancel();
    setDraft(null);
    update((x) => keepOriginal(x, active.id));
    setPhase("accepted");
    if (settings.autoProgress) advanceTimer.current = window.setTimeout(goToNextOpen, settings.transitionDelayMs);
  }, [active, goToNextOpen, settings.autoProgress, settings.transitionDelayMs, speech, update]);

  const skip = useCallback(() => {
    if (!active) return;
    update((x) => skipSegment(x, active.id));
    move(1);
  }, [active, move, update]);

  const keepMine = useCallback(() => {
    if (!active) return;
    update((x) => keepMyVersion(x, active.id));
    setPhase("accepted");
    setShowDetails(false);
    clearAdvance();
    if (settings.autoProgress) advanceTimer.current = window.setTimeout(goToNextOpen, settings.transitionDelayMs);
  }, [active, goToNextOpen, settings.autoProgress, settings.transitionDelayMs, update]);

  const addDetail = useCallback(() => {
    clearAdvance();
    setShowDetails(true);
    // If the mic is already open on this line, whatever is said next is added to it.
    if (speech.isContinuation()) {
      flowToken.current++;
      setPhase("idle");
      return;
    }
    nextModeRef.current = "append";
    setPhase("idle");
    setArmed(true);
  }, [speech]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.altKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (mode === "rewrite") {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "?") return setHelpOpen((v) => !v);
      if (e.key === "Escape") {
        if (helpOpen) return setHelpOpen(false);
        if (settingsOpen) return setSettingsOpen(false);
        if (armed) return setArmed(false);
        return;
      }
      if (mode !== "rewrite" || settingsOpen || helpOpen) return;
      const target = e.target as HTMLElement;
      switch (e.key) {
        case " ":
          if (target.tagName === "BUTTON" && target.dataset.testid !== "mic-button") return;
          e.preventDefault();
          if (target.dataset.testid !== "mic-button") toggleMic();
          return;
        case "Enter":
          if (target.tagName === "BUTTON" || target.getAttribute("role") === "button") return;
          e.preventDefault();
          return done();
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          return move(-1);
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          return move(1);
      }
      switch (e.key.toLowerCase()) {
        case "r":
          return redo();
        case "e":
          e.preventDefault();
          return void openEditor();
        case "u":
          return undo();
        case "o":
          return keepOriginalWording();
        case "s":
          return skip();
        case "k":
          if (phase === "issue") keepMine();
          return;
        case "a":
          if (phase === "issue") addDetail();
          return;
        case "d":
          return setShowDetails((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, phase, armed, helpOpen, settingsOpen, toggleMic, done, move, redo, openEditor, undo, keepOriginalWording, skip, keepMine, addDetail]);

  useEffect(() => () => clearAdvance(), []);

  // Informational notices fade on their own; errors stay until the user acts or moves on.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    setSpeechError(null);
  }, [mode, doc?.activeSegmentId]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg">{loadError === "not-found" ? "This session doesn’t exist on this device." : "This session couldn’t be read."}</p>
        <p className="text-sm text-muted">Sessions are saved in this browser only.</p>
        <Link href="/" className="text-accent underline-offset-4 hover:underline">
          Back to Revoice
        </Link>
      </main>
    );
  }
  if (!doc) return <main className="min-h-dvh" aria-busy="true" />;

  const prog = progress(doc);
  const issues = active ? unresolvedImportantIssues(active) : [];
  const rev = active ? currentRevision(active) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Top bar */}
      <header className="relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line/60 px-2 sm:gap-3 sm:px-5">
        <Link href="/" aria-label="Exit to all documents" title="Exit" className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg">
          <ChevronLeft />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{doc.title}</h1>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-[3px] w-16 overflow-hidden rounded-full bg-line sm:w-28" aria-hidden="true">
              <motion.div className="h-full bg-accent" initial={false} animate={{ width: `${prog.percent}%` }} />
            </div>
            <span className="whitespace-nowrap text-[12px] tabular-nums text-muted" data-testid="progress">
              {prog.percent}% · {prog.done}/{prog.total}
            </span>
          </div>
        </div>
        <nav aria-label="View" className="hidden rounded-lg bg-surface p-0.5 sm:flex">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-current={mode === m.id ? "page" : undefined}
              className={`h-8 rounded-md px-3 text-[13px] font-medium transition-colors ${mode === m.id ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <select
          aria-label="View"
          className="h-9 rounded-lg border border-line bg-surface px-2 text-sm sm:hidden"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {mode === "rewrite" && (
          <IconButton label="Pause (Esc)" onClick={() => setArmed(false)} disabled={!armed}>
            <PauseIcon />
          </IconButton>
        )}
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </IconButton>
      </header>

      {/* Notices */}
      <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {saveError && (
            <Toast key="save" tone="danger">
              Couldn’t save to this browser: {saveError} Copy your text from Export to keep it safe.
            </Toast>
          )}
          {speechError && (
            <Toast key="speech" tone="warn" onClose={() => setSpeechError(null)}>
              {speechError.message.replace(/([^.!?])$/, "$1.")}
              {" You can always type your version instead (E)."}
            </Toast>
          )}
          {notice && (
            <Toast key="notice" tone="muted" onClose={() => setNotice(null)}>
              {notice}
            </Toast>
          )}
          {!providerInfo.supported && mode === "rewrite" && (
            <Toast key="unsupported" tone="warn">
              {providerId === "webspeech"
                ? "This browser has no built-in speech recognition (Firefox doesn’t support it). Use Chrome, Edge or Safari, switch to OpenAI transcription in Settings, or type your versions (E)."
                : "This browser can’t record audio. Type your versions (E)."}
            </Toast>
          )}
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {/* Body */}
      {mode === "rewrite" && (
        <>
          <main className="relative min-h-0 flex-1">
            <LyricsView doc={doc} activeId={doc.activeSegmentId} phase={phase} showDetails={showDetails} onSelect={(sid) => void goTo(sid)} />
          </main>
          <div className="relative z-10 shrink-0 space-y-3 pb-0">
            <AnimatePresence mode="wait">
              {phase === "issue" && active?.check && issues.length > 0 && (
                <IssuePanel
                  key="issue"
                  check={active.check}
                  issues={issues}
                  onAdd={addDetail}
                  onReviewOriginal={() => setShowDetails((v) => !v)}
                  showingOriginal={showDetails}
                  onKeep={keepMine}
                  onRedo={redo}
                />
              )}
              {phase === "editing" && active && (
                <EditSheet
                  key="edit"
                  original={active.originalText}
                  initial={(draft?.segmentId === active.id ? draft.text : null) ?? currentText(active) ?? ""}
                  rawTranscript={rev?.rawTranscript}
                  onCancel={() => {
                    setPhase("idle");
                    setArmed(armedBeforeEdit.current);
                  }}
                  onSave={(text) => {
                    setDraft(null);
                    setPhase("idle");
                    saveVersion(active.id, text, currentText(active) ? "edit" : "typed", true);
                    setArmed(armedBeforeEdit.current);
                  }}
                />
              )}
            </AnimatePresence>
            {active?.check && phase !== "editing" && phase !== "issue" && currentText(active) === active.check.checkedText && (
              <MinorNotes
                check={active.check}
                onApplySuggestion={(sid) => update((x) => applySuggestion(x, active.id, sid))}
                onDismissSuggestion={(sid) => update((x) => dismissSuggestion(x, active.id, sid))}
              />
            )}
            <RecorderDock
              speechState={speech.state}
              armed={armed}
              phase={phase}
              transcript={speech.partial}
              level={speech.level}
              silenceProgress={speech.silenceProgress}
              savedText={active ? currentText(active) : null}
              draft={draft?.segmentId === active?.id ? draft?.text ?? null : null}
              providerLabel={providerInfo.label}
              simulated={providerId === "simulated"}
              canPrev={activeIndex > 0}
              canNext={activeIndex < doc.segments.length - 1}
              canUndo={!!active && canUndo(active)}
              onMic={toggleMic}
              onDone={done}
              onPrev={() => move(-1)}
              onNext={skip}
              onRedo={redo}
              onUndo={undo}
              onEdit={() => void openEditor()}
              onKeepOriginal={keepOriginalWording}
            />
          </div>
          {simulatedSpeechEnabled() && providerId === "simulated" && <SimulatedSpeechPanel />}
        </>
      )}
      {mode === "preview" && <PreviewView doc={doc} onOpenSegment={(sid) => void goTo(sid)} />}
      {mode === "review" && <ReviewView doc={doc} update={update} get={get} onOpenSegment={(sid) => void goTo(sid)} onExport={() => setMode("export")} />}
      {mode === "export" && <ExportView doc={doc} update={update} onBack={() => setMode("rewrite")} />}
      {mode === "segments" && <SegmentsEditor doc={doc} update={update} onClose={() => setMode("rewrite")} />}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onAdjustSegments={() => { setSettingsOpen(false); setArmed(false); setMode("segments"); }} />}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function Toast({ children, tone, onClose }: { children: React.ReactNode; tone: "warn" | "danger" | "muted"; onClose?: () => void }) {
  const color = tone === "danger" ? "border-danger/40 text-danger" : tone === "warn" ? "border-warn/40 text-warn" : "border-line text-muted";
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`pointer-events-auto flex max-w-xl items-start gap-2 rounded-xl border bg-surface/95 px-4 py-2.5 text-[13px] shadow-lg backdrop-blur ${color}`}
    >
      <AlertIcon size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
          <CloseIcon size={16} />
        </button>
      )}
    </motion.div>
  );
}

/** Visible only with the simulated (testing) speech provider. */
function SimulatedSpeechPanel() {
  const [text, setText] = useState("");
  return (
    <form
      className="fixed left-3 top-16 z-30 flex gap-2 rounded-lg border border-warn/40 bg-surface p-2 text-[12px]"
      onSubmit={(e) => {
        e.preventDefault();
        const w = window as unknown as { __revoiceSpeech?: { say(t: string): Promise<void> } };
        void w.__revoiceSpeech?.say(text);
        setText("");
      }}
    >
      <input
        aria-label="Simulate speaking"
        className="w-44 rounded border border-line bg-bg px-2 py-1 sm:w-56"
        placeholder="Simulate saying…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="text-warn" type="submit">
        Say
      </button>
    </form>
  );
}
