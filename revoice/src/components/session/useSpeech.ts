"use client";

/**
 * Glue between a SpeechProvider, the level meter and the end-of-speech
 * detector. Each utterance is tagged with the context it was started for
 * (the target segment) and a token, so late results from a cancelled or
 * finished utterance can never land on the wrong segment or be applied twice.
 *
 * A "continuation" utterance listens on a segment that already has text
 * (while it is being checked, or waiting to move on). Its prefix is that text;
 * if the user speaks again, `onResume` fires and the new words are added to
 * the same segment rather than spilling onto the next one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProvider, EndOfSpeechDetector, PauseProfile, SpeechError,
  type SpeechProvider, type StartOptions,
} from "@/lib/speech";
import type { Settings } from "@/lib/types";
import { openMicrophone, startLevelMeter } from "@/lib/speech/audio-level";
import { joinSpoken } from "@/lib/meaning/cleanup";

export type SpeechState = "off" | "starting" | "listening" | "hearing" | "finishing";

export interface UtteranceContext {
  segmentId: string;
  mode: "replace" | "append";
  /** Listening on a segment that already has text; the prefix is that text. */
  continuation?: boolean;
}

/** If the user resumes within this long after we ended an utterance, we ended it too early. */
const FALSE_FINISH_WINDOW_MS = 6000;

interface Options {
  providerId: Settings["speechProvider"];
  refine: boolean;
  language: string;
  silenceMs: number;
  adaptive: boolean;
  onUtterance(text: string, raw: string, ctx: UtteranceContext): void;
  /** Utterance ended with nothing new heard. */
  onEmpty(ctx: UtteranceContext): void;
  /** First new words of a continuation utterance: the user is still talking about this segment. */
  onResume(ctx: UtteranceContext): void;
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
  /** Text the utterance started with (saved text for continuations, a paused draft otherwise). */
  const prefixRef = useRef("");
  /** Words heard in this utterance, excluding the prefix. */
  const newTextRef = useRef("");
  const resumedRef = useRef(false);
  const stateRef = useRef<SpeechState>("off");
  const meterRef = useRef<{ stop(): void } | null>(null);
  const lastFinishAt = useRef(0);

  const set = (s: SpeechState) => {
    stateRef.current = s;
    setState(s);
  };

  const join = joinSpoken;

  // (Re)create the provider when the choice changes.
  useEffect(() => {
    const p = createProvider(opts.providerId, { refine: opts.refine });
    providerRef.current = p;
    return () => {
      tokenRef.current++;
      p.dispose();
      if (providerRef.current === p) providerRef.current = null;
      stateRef.current = "off";
      setState("off");
    };
  }, [opts.providerId, opts.refine]);

  const stopMeter = useCallback(() => {
    meterRef.current?.stop();
    meterRef.current = null;
    setLevel(0);
  }, []);

  /** Waveform for the browser provider, which doesn't report levels itself. */
  const ensureMeter = useCallback(async () => {
    if (meterRef.current || optsRef.current.providerId !== "webspeech") return;
    try {
      const stream = await openMicrophone();
      const stop = startLevelMeter(stream, { onLevel: (l) => setLevel(l) });
      meterRef.current = {
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
      newTextRef.current = "";
      resumedRef.current = false;
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
              newTextRef.current = text.trim();
              setPartial(join(prefixRef.current, newTextRef.current));
              if (ctx.continuation && newTextRef.current && !resumedRef.current) {
                resumedRef.current = true;
                if (performance.now() - lastFinishAt.current < FALSE_FINISH_WINDOW_MS) profileRef.current.reportFalseFinish();
                optsRef.current.onResume(ctx);
              }
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
        if (token === tokenRef.current && stateRef.current === "starting") set("listening");
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
      text = (await provider.finish()).trim();
    } catch (e) {
      if (token !== tokenRef.current) return;
      set("off");
      // Keep whatever was heard live rather than losing it.
      if (newTextRef.current) {
        const kept = join(prefixRef.current, newTextRef.current);
        optsRef.current.onUtterance(kept, kept, ctx);
      }
      optsRef.current.onError(e instanceof SpeechError ? e : new SpeechError("service", "Transcription failed."));
      return;
    }
    if (token !== tokenRef.current) return;
    const prefix = prefixRef.current;
    prefixRef.current = "";
    set("off");
    setSilenceProgress(0);
    if (!text) {
      // Nothing new: a continuation just goes back to waiting; a fresh one keeps any draft.
      if (prefix && !ctx.continuation) optsRef.current.onUtterance(prefix, prefix, ctx);
      else optsRef.current.onEmpty(ctx);
      return;
    }
    const full = join(prefix, text);
    setPartial(full);
    optsRef.current.onUtterance(full, full, ctx);
  }, []);

  /**
   * Stop listening but keep what was said. Returns the full text and whether
   * anything new was said in this utterance (beyond its prefix).
   */
  const pause = useCallback(async (): Promise<{ text: string; hasNew: boolean; ctx: UtteranceContext | null }> => {
    const provider = providerRef.current;
    const ctx = ctxRef.current;
    const wasActive = stateRef.current !== "off";
    tokenRef.current++;
    let added = newTextRef.current;
    if (provider && wasActive) {
      try {
        added = (await provider.finish()).trim() || added;
      } catch {
        /* keep the live text */
      }
    }
    const text = join(prefixRef.current, added);
    set("off");
    setSilenceProgress(0);
    stopMeter();
    return { text, hasNew: !!added, ctx };
  }, [stopMeter]);

  /** Stop and discard the current utterance. */
  const cancel = useCallback(() => {
    tokenRef.current++;
    providerRef.current?.cancel();
    prefixRef.current = "";
    newTextRef.current = "";
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
      // A continuation only ends once it has new words; noise alone just keeps waiting.
      if (ctxRef.current?.continuation && !newTextRef.current) return;
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
    activeContext: () => ctxRef.current,
    /** True once the user has said something in the current utterance. */
    hasNewWords: () => stateRef.current !== "off" && !!newTextRef.current,
    isContinuation: () => stateRef.current !== "off" && !!ctxRef.current?.continuation,
    start,
    finish,
    pause,
    cancel,
    release,
    clearPartial: () => setPartial(""),
  };
}
