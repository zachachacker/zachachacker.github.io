"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useServerStatus, useSettings } from "@/components/AppProviders";
import { providerMeta, simulatedSpeechEnabled } from "@/lib/speech";
import { getStore } from "@/lib/storage/store";
import type { Settings } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/Icons";

function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={htmlFor} className="text-sm text-fg">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[12px] text-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

const LANGUAGES = [
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["en-AU", "English (Australia)"],
  ["en-IN", "English (India)"],
  ["es-ES", "Español"],
  ["fr-FR", "Français"],
  ["de-DE", "Deutsch"],
  ["it-IT", "Italiano"],
  ["pt-PT", "Português"],
  ["nl-NL", "Nederlands"],
];

export function SettingsPanel({ onClose, onAdjustSegments }: { onClose(): void; onAdjustSegments?: () => void }) {
  const { settings, update } = useSettings();
  const { status } = useServerStatus();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => update({ [k]: v } as Partial<Settings>);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const providerNote = providerMeta(settings.speechProvider).privacyNote;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.22 }}
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface px-5 py-4 scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Settings</h2>
          <button ref={closeRef} type="button" aria-label="Close settings" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg">
            <CloseIcon />
          </button>
        </div>

        <h3 className="mt-5 text-[12px] uppercase tracking-wide text-faint">Flow</h3>
        <div className="divide-y divide-line/60">
          <Row label="Move on automatically" hint="Advance to the next idea when the meaning checks out." htmlFor="s-auto">
            <Toggle id="s-auto" checked={settings.autoProgress} onChange={set("autoProgress")} />
          </Row>
          <Row label={`Pause before moving on: ${(settings.transitionDelayMs / 1000).toFixed(1)} s`} htmlFor="s-delay">
            <input id="s-delay" type="range" min={0} max={2500} step={100} value={settings.transitionDelayMs} onChange={(e) => set("transitionDelayMs")(Number(e.target.value))} className="w-32 accent-[var(--color-accent)]" />
          </Row>
          <Row label={`Silence before finishing: ${(settings.silenceMs / 1000).toFixed(1)} s`} hint="How long a pause counts as “I’m done”." htmlFor="s-silence">
            <input id="s-silence" type="range" min={1000} max={4000} step={100} value={settings.silenceMs} onChange={(e) => set("silenceMs")(Number(e.target.value))} className="w-32 accent-[var(--color-accent)]" />
          </Row>
          <Row label="Learn my pauses" hint="Lengthens the silence threshold if you naturally pause mid-sentence." htmlFor="s-adapt">
            <Toggle id="s-adapt" checked={settings.adaptiveSilence} onChange={set("adaptiveSilence")} />
          </Row>
        </div>

        <h3 className="mt-6 text-[12px] uppercase tracking-wide text-faint">Your words</h3>
        <div className="divide-y divide-line/60">
          <Row label="Cleanup" hint="Minimal: only capitals, punctuation and fillers. Suggest: also offers small fixes you approve one by one." htmlFor="s-cleanup">
            <select id="s-cleanup" value={settings.cleanup} onChange={(e) => set("cleanup")(e.target.value as Settings["cleanup"])} className="h-9 rounded-lg border border-line bg-bg px-2 text-sm">
              <option value="minimal">Minimal</option>
              <option value="suggest">Suggest changes</option>
            </select>
          </Row>
          <Row label="Remove filler words" hint="“um”, “uh”, “erm” and stutters like “I I”." htmlFor="s-fillers">
            <Toggle id="s-fillers" checked={settings.removeFillers} onChange={set("removeFillers")} />
          </Row>
        </div>

        <h3 className="mt-6 text-[12px] uppercase tracking-wide text-faint">Speech</h3>
        <div className="divide-y divide-line/60">
          <Row label="Recogniser" htmlFor="s-provider">
            <select id="s-provider" value={settings.speechProvider} onChange={(e) => set("speechProvider")(e.target.value as Settings["speechProvider"])} className="h-9 rounded-lg border border-line bg-bg px-2 text-sm">
              <option value="webspeech">Browser (live)</option>
              <option value="openai" disabled={status?.transcription === false}>
                OpenAI{status?.transcription === false ? " (not configured)" : ""}
              </option>
              {simulatedSpeechEnabled() && <option value="simulated">Simulated (testing)</option>}
            </select>
          </Row>
          <Row label="Language" htmlFor="s-lang">
            <select id="s-lang" value={settings.speechLanguage} onChange={(e) => set("speechLanguage")(e.target.value)} className="h-9 rounded-lg border border-line bg-bg px-2 text-sm">
              {LANGUAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Row>
        </div>
        <p className="mt-1 text-[12px] text-faint">{providerNote}</p>

        <h3 className="mt-6 text-[12px] uppercase tracking-wide text-faint">Display</h3>
        <div className="divide-y divide-line/60">
          <Row label={`Text size: ${Math.round(settings.fontScale * 100)}%`} htmlFor="s-size">
            <input id="s-size" type="range" min={0.8} max={1.6} step={0.05} value={settings.fontScale} onChange={(e) => set("fontScale")(Number(e.target.value))} className="w-32 accent-[var(--color-accent)]" />
          </Row>
          <Row label="High contrast" htmlFor="s-contrast">
            <Toggle id="s-contrast" checked={settings.highContrast} onChange={set("highContrast")} />
          </Row>
          <Row label="Reduce motion" htmlFor="s-motion">
            <select id="s-motion" value={settings.reducedMotion} onChange={(e) => set("reducedMotion")(e.target.value as Settings["reducedMotion"])} className="h-9 rounded-lg border border-line bg-bg px-2 text-sm">
              <option value="system">Follow system</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Row>
        </div>

        <h3 className="mt-6 text-[12px] uppercase tracking-wide text-faint">Privacy</h3>
        <div className="divide-y divide-line/60">
          <Row
            label="AI checking (OpenAI)"
            hint={
              status?.ai === false
                ? "Not configured on this server — offline checks are used."
                : "Sends each segment, your version and nearby context to OpenAI to check meaning. Off = offline checks only."
            }
            htmlFor="s-ai"
          >
            <Toggle id="s-ai" checked={settings.aiEnabled} onChange={set("aiEnabled")} />
          </Row>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          Documents are stored only in this browser. Revoice doesn’t record or keep audio, and the server doesn’t log your text.
        </p>
        <div className="mt-3">
          {!confirmDelete ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete all documents on this device
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-danger">Delete everything?</span>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  await getStore().deleteAll();
                  window.location.href = "/";
                }}
              >
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        {onAdjustSegments && (
          <>
            <h3 className="mt-6 text-[12px] uppercase tracking-wide text-faint">This document</h3>
            <div className="mt-2">
              <Button size="sm" onClick={onAdjustSegments}>
                Adjust segments (merge / split)
              </Button>
            </div>
          </>
        )}
        <div className="h-8" />
        <IconButton label="Close settings" onClick={onClose} className="sr-only-focusable">
          <CloseIcon />
        </IconButton>
      </motion.aside>
    </div>
  );
}
