"use client";

/**
 * Glue between a SpeechProvider, the level meter and the end-of-speech
 * detector. Each utterance is tagged with the context it was started for
 * (the target segment) and a token, so late results from a cancelled or
 * finished utterance can never land on the wrong segment or be applied twice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProvider, EndOfSpeechDetector, PauseProfile, SpeechError,
  type SpeechProvider, type StartOptions,
} from "@/lib/speech";
import type { Settings } from "@/lib/types";
import { openMicrophone, startLevelMeter } from "@/lib/speech/audio-level";

export type SpeechState = "off" | "starting" | "listening" | "hearing" | "finishing";

export interface UtteranceContext {
  segmentId: string;
  mode: "replace" | "append";
}

interface Options {
  providerId: Settings["speechProvider"];
  language: string;
  silenceMs: number;
  adaptive: boolean;
  onUtterance(text: string, raw: string, ctx: UtteranceContext): void;
  /** Utterance ended with nothing heard. */
  onEmpty(ctx: UtteranceContext): void;
  onError(err: SpeechError): void;
}

export function useSpeech(opts: Options) {
  const [state, setState] = useState<SpeechState>("off");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [silenceProgress, setSilenceProgress] = useState(0);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const providerRef = useRef<SpeechProvider | null>(null);
  const profileRef = useRef(new PauseProfile());
  const detectorRef = useRef<EndOfSpeechDetector | null>(null);
  const tokenRef = useRef(0);
  const ctxRef = useRef<UtteranceContext | null>(null);
  /** Text carried over from before a pause, prepended to the resumed utterance. */
  const prefixRef = useRef("");
  const partialRef = useRef("");
  const stateRef = useRef<SpeechState>("off");
  const meterRef = useRef<{ stream: MediaStream; stop(): void } | null>(null);
  const lastFinishAt = useRef(0);
  const lastVoiceReport = useRef(0);

  const set = (s: SpeechState) => {
    stateRef.current = s;
    setState(s);
  };

  // (Re)create the provider when the choice changes.
  useEffect(() => {
    const p = createProvider(opts.providerId);
    providerRef.current = p;
    return () => {
      tokenRef.current++;
      p.dispose();
      if (providerRef.current === p) providerRef.current = null;
    };
  }, [opts.providerId]);

  const stopMeter = useCallback(() => {
    meterRef.current?.stop();
    meterRef.current = null;
    setLevel(0);
  }, []);

  /** Waveform for providers that don't report levels themselves. */
  const ensureMeter = useCallback(async () => {
    if (meterRef.current || optsRef.current.providerId !== "webspeech") return;
    try {
      const stream = await openMicrophone();
      const stop = startLevelMeter(stream, {
        onLevel: (l) => setLevel(l),
        onVoice: () => {
          // Voice right after we auto-finished means we cut the user off: learn from it.
          const now = performance.now();
          if (
            lastFinishAt.current &&
            now - lastFinishAt.current < 1200 &&
            now - lastVoiceReport.current > 2000 &&
            stateRef.current !== "listening" &&
            stateRef.current !== "hearing"
          ) {
            lastVoiceReport.current = now;
            profileRef.current.reportFalseFinish();
          }
        },
      });
      meterRef.current = {
        stream,
        stop: () => {
          stop();
          stream.getTracks().forEach((t) => t.stop());
        },
      };
    } catch {
      /* the recogniser itself will report permission problems */
    }
  }, []);

  const start = useCallback(
    async (ctx: UtteranceContext, startOpts: Omit<StartOptions, "language"> = {}, prefix = "") => {
      const provider = providerRef.current;
      if (!provider) return;
      const token = ++tokenRef.current;
      ctxRef.current = ctx;
      prefixRef.current = prefix;
      partialRef.current = prefix;
      setPartial(prefix);
      setSilenceProgress(0);
      detectorRef.current = new EndOfSpeechDetector(
        { baseMs: optsRef.current.silenceMs, adaptive: optsRef.current.adaptive },
        profileRef.current,
      );
      set("starting");
      void ensureMeter();
      try {
        await provider.start(
          {
            onPartial: (text) => {
              if (token !== tokenRef.current) return;
              const full = [prefixRef.current, text].filter(Boolean).join(" ");
              partialRef.current = full;
              setPartial(full);
            },
            onActivity: () => {
              if (token !== tokenRef.current) return;
              detectorRef.current?.activity(performance.now());
              if (stateRef.current === "listening") set("hearing");
            },
            onLevel: (l) => {
              if (token === tokenRef.current) setLevel(l);
            },
            onError: (err) => {
              if (token !== tokenRef.current) return;
              tokenRef.current++;
              set("off");
              optsRef.current.onError(err);
            },
          },
          { language: optsRef.current.language, ...startOpts },
        );
        if (token === tokenRef.current) set("listening");
      } catch (e) {
        if (token !== tokenRef.current) return;
        tokenRef.current++;
        set("off");
        optsRef.current.onError(e instanceof SpeechError ? e : new SpeechError("service", "Couldn't start the microphone."));
      }
    },
    [ensureMeter],
  );

  const finish = useCallback(async () => {
    const provider = providerRef.current;
    const ctx = ctxRef.current;
    if (!provider || !ctx || (stateRef.current !== "listening" && stateRef.current !== "hearing")) return;
    const token = ++tokenRef.current;
    set("finishing");
    lastFinishAt.current = performance.now();
    let text = "";
    try {
      text = await provider.finish();
    } catch (e) {
      if (token !== tokenRef.current) return;
      set("off");
      // Keep whatever was heard live rather than losing it.
      const kept = partialRef.current.trim();
      if (kept) optsRef.current.onUtterance(kept, kept, ctx);
      optsRef.current.onError(e instanceof SpeechError ? e : new SpeechError("service", "Transcription failed."));
      return;
    }
    if (token !== tokenRef.current) return;
    const full = [prefixRef.current, text].filter(Boolean).join(" ").trim();
    prefixRef.current = "";
    set("off");
    setSilenceProgress(0);
    if (full) optsRef.current.onUtterance(full, full, ctx);
    else optsRef.current.onEmpty(ctx);
  }, []);

  /** Stop listening but keep what was said, to continue later. Returns the kept text. */
  const pause = useCallback(async (): Promise<string> => {
    const provider = providerRef.current;
    const wasActive = stateRef.current !== "off";
    tokenRef.current++;
    let kept = partialRef.current;
    if (provider && wasActive) {
      try {
        const t = await provider.finish();
        kept = [prefixRef.current, t].filter(Boolean).join(" ") || kept;
      } catch {
        /* keep the live text */
      }
    }
    set("off");
    setSilenceProgress(0);
    stopMeter();
    return kept.trim();
  }, [stopMeter]);

  /** Stop and discard the current utterance. */
  const cancel = useCallback(() => {
    tokenRef.current++;
    providerRef.current?.cancel();
    prefixRef.current = "";
    partialRef.current = "";
    setPartial("");
    setSilenceProgress(0);
    set("off");
  }, []);

  const release = useCallback(() => {
    cancel();
    stopMeter();
  }, [cancel, stopMeter]);

  // Silence watcher.
  useEffect(() => {
    if (state !== "hearing" && state !== "listening") return;
    const id = window.setInterval(() => {
      const d = detectorRef.current;
      if (!d || !d.hasSpeech) return;
      const now = performance.now();
      setSilenceProgress(Math.min(1, d.silenceMs(now) / d.threshold()));
      if (d.shouldFinish(now)) void finish();
    }, 80);
    return () => window.clearInterval(id);
  }, [state, finish]);

  useEffect(() => () => stopMeter(), [stopMeter]);

  return {
    state,
    partial,
    level,
    silenceProgress,
    threshold: () => detectorRef.current?.threshold() ?? opts.silenceMs,
    activeContext: () => ctxRef.current,
    start,
    finish,
    pause,
    cancel,
    release,
    clearPartial: () => {
      partialRef.current = "";
      setPartial("");
    },
  };
}
