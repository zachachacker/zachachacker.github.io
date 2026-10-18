"use client";

import { motion } from "motion/react";
import type { SpeechState } from "./useSpeech";
import type { FlowPhase } from "./LyricsView";
import {
  CheckIcon, ChevronDown, ChevronUp, KeyboardIcon, MicIcon, PauseIcon, PencilIcon, QuoteIcon, RedoIcon, UndoIcon,
} from "@/components/ui/Icons";
import { IconButton } from "@/components/ui/Button";

interface Props {
  speechState: SpeechState;
  armed: boolean;
  phase: FlowPhase;
  transcript: string;
  level: number;
  silenceProgress: number;
  /** Text already saved for this segment, shown when nothing is being said. */
  savedText: string | null;
  draft: string | null;
  providerLabel: string;
  simulated: boolean;
  canPrev: boolean;
  canNext: boolean;
  canUndo: boolean;
  onMic(): void;
  onDone(): void;
  onPrev(): void;
  onNext(): void;
  onRedo(): void;
  onUndo(): void;
  onEdit(): void;
  onKeepOriginal(): void;
}

function Waveform({ level, active }: { level: number; active: boolean }) {
  const bars = [0.55, 0.85, 1, 0.75, 0.5];
  return (
    <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
      {bars.map((m, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-accent transition-[height] duration-100"
          style={{ height: active ? `${Math.max(3, Math.min(20, 3 + level * 26 * m))}px` : "3px", opacity: active ? 1 : 0.4 }}
        />
      ))}
    </span>
  );
}

function statusText(state: SpeechState, phase: FlowPhase, armed: boolean, hasDraft: boolean): string {
  if (phase === "checking") return "Checking the meaning…";
  if (phase === "accepted") return "Got it";
  if (phase === "issue") return "Have a look at this one";
  if (phase === "editing") return "Editing";
  switch (state) {
    case "starting":
      return "Starting microphone…";
    case "listening":
      return "Listening — say it your way";
    case "hearing":
      return "Listening";
    case "finishing":
      return "Finishing…";
    default:
      return armed ? "Ready" : hasDraft ? "Paused — your words so far are kept" : "Microphone off";
  }
}

export function RecorderDock(p: Props) {
  const listening = p.speechState === "listening" || p.speechState === "hearing" || p.speechState === "starting";
  const words = p.transcript ? p.transcript.split(/\s+/) : [];
  const showSaved = !p.transcript && p.savedText && !listening;
  const status = statusText(p.speechState, p.phase, p.armed, !!p.draft);

  return (
    <section aria-label="Recording" className="relative border-t border-line/70 bg-bg/80 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-5 sm:px-10">
        {/* Status line */}
        <div className="flex items-center gap-3 text-[13px] text-muted">
          <Waveform level={p.level} active={p.speechState === "hearing" || p.speechState === "listening"} />
          <span role="status" aria-live="polite" className="font-medium">
            {status}
          </span>
          {p.simulated && (
            <span className="rounded border border-warn/40 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn">
              Simulated speech
            </span>
          )}
          <span className="ml-auto hidden text-faint sm:inline">{p.providerLabel}</span>
        </div>

        {/* Live transcript */}
        <div className="transcript-text mt-3 min-h-[3.25rem] text-fg" aria-live="off">
          {words.length > 0 ? (
            <p data-testid="live-transcript">
              {words.map((w, i) => (
                <motion.span
                  key={`${i}-${w}`}
                  initial={{ opacity: 0, y: 5, filter: "blur(2px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.22 }}
                  className="inline-block whitespace-pre"
                >
                  {w}{i < words.length - 1 ? " " : ""}
                </motion.span>
              ))}
            </p>
          ) : showSaved ? (
            <p className="text-muted">
              <span className="mr-2 text-[12px] uppercase tracking-wide text-faint">Your version</span>
              {p.savedText}
            </p>
          ) : (
            <p className="text-faint">{listening ? "…" : "Press the microphone (or Space) and say this in your own words."}</p>
          )}
        </div>

        {/* Silence countdown: fills as the pause approaches the end-of-speech threshold. */}
        <div className="mt-2 h-[2px] w-full overflow-hidden rounded bg-line/60" aria-hidden="true">
          <div
            className="h-full bg-accent/70 transition-[width] duration-100"
            style={{ width: `${p.speechState === "hearing" ? Math.round(p.silenceProgress * 100) : 0}%` }}
          />
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center sm:gap-1">
            <IconButton label="Previous segment (↑)" onClick={p.onPrev} disabled={!p.canPrev}>
              <ChevronUp />
            </IconButton>
            <IconButton label="Skip to next segment (↓)" onClick={p.onNext} disabled={!p.canNext}>
              <ChevronDown />
            </IconButton>
            <IconButton label="Redo this segment (R)" onClick={p.onRedo}>
              <RedoIcon />
            </IconButton>
            <IconButton label="Undo last version (U)" onClick={p.onUndo} disabled={!p.canUndo}>
              <UndoIcon />
            </IconButton>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={p.onMic}
              aria-pressed={p.armed}
              aria-label={p.armed ? "Pause microphone (Space)" : "Start microphone (Space)"}
              data-testid="mic-button"
              className={`relative isolate flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                p.armed ? "bg-accent text-white" : "bg-raised text-fg ring-1 ring-line hover:ring-faint"
              } ${listening ? "mic-pulse" : ""}`}
            >
              {p.armed ? <PauseIcon size={24} /> : <MicIcon size={24} />}
            </button>
          </div>

          <div className="flex items-center sm:gap-1">
            <IconButton label="Edit or type your version (E)" onClick={p.onEdit}>
              <PencilIcon />
            </IconButton>
            <IconButton label="Use the original wording (O)" onClick={p.onKeepOriginal}>
              <QuoteIcon />
            </IconButton>
            <button
                type="button"
                onClick={p.onDone}
                aria-label="Done with this segment (Enter)"
                title="Done (Enter)"
                className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-medium text-fg transition-colors hover:border-faint disabled:opacity-30 sm:px-4"
                disabled={!listening && !p.savedText}
              >
                <CheckIcon size={16} /> <span className="hidden sm:inline">Done</span>
            </button>
          </div>
        </div>
        <p className="mt-3 hidden items-center justify-center gap-1.5 text-[12px] text-faint sm:flex">
          <KeyboardIcon size={14} /> Space mic · Enter done · ↑↓ move · R redo · E edit · ? all shortcuts
        </p>
      </div>
    </section>
  );
}
