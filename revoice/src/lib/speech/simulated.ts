/**
 * SIMULATED SPEECH — FOR DEVELOPMENT AND AUTOMATED TESTS ONLY.
 *
 * Emits words as if a user were speaking, so the whole flow (live partials,
 * pauses, end-of-speech detection, auto-advance) can be exercised in a
 * headless browser with no microphone. It is only available when
 * NEXT_PUBLIC_ENABLE_SIMULATED_SPEECH=1 or in `next dev`, and the UI shows a
 * visible "Simulated speech" badge whenever it is active.
 *
 * Drive it from the console or a test:
 *   await window.__revoiceSpeech.say("could we meet on friday", { wordMs: 150 })
 *   await window.__revoiceSpeech.say("part one ... part two")   // "..." = 2.5 s pause
 *   window.__revoiceSpeech.fail("network")
 */

import { SpeechError, type SpeechErrorKind, type SpeechEvents, type SpeechProvider } from "./types";

export function simulatedSpeechEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SIMULATED_SPEECH === "1" || process.env.NODE_ENV === "development";
}

interface SayOptions {
  wordMs?: number;
  /** Duration of a "..." pause in the text. */
  pauseMs?: number;
}

export interface SimulatedSpeechControl {
  say(text: string, opts?: SayOptions): Promise<void>;
  fail(kind: SpeechErrorKind): void;
  isListening(): boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimulatedSpeechProvider implements SpeechProvider {
  readonly id = "simulated" as const;
  readonly label = "Simulated speech (testing)";
  readonly privacyNote = "Simulated speech for testing. No microphone is used.";

  private events: SpeechEvents | null = null;
  private words: string[] = [];
  private listening = false;

  isSupported() {
    return true;
  }

  async start(events: SpeechEvents) {
    // Only the provider that is actually listening owns the test hook.
    if (typeof window !== "undefined") {
      const control: SimulatedSpeechControl = {
        say: (text, opts) => this.say(text, opts),
        fail: (kind) => this.events?.onError(new SpeechError(kind, `Simulated ${kind} error`, kind !== "permission-denied")),
        isListening: () => this.listening,
      };
      (window as unknown as { __revoiceSpeech: SimulatedSpeechControl }).__revoiceSpeech = control;
    }
    this.events = events;
    this.words = [];
    this.listening = true;
  }

  private async say(text: string, opts: SayOptions = {}) {
    const wordMs = opts.wordMs ?? 120;
    const pauseMs = opts.pauseMs ?? 2500;
    for (const token of text.split(/\s+/).filter(Boolean)) {
      if (!this.listening) return;
      if (token === "...") {
        await sleep(pauseMs);
        continue;
      }
      this.words.push(token);
      this.events?.onActivity();
      this.events?.onLevel?.(0.4 + Math.random() * 0.4);
      this.events?.onPartial(this.words.join(" "));
      await sleep(wordMs);
    }
    this.events?.onLevel?.(0);
  }

  async finish() {
    this.listening = false;
    const text = this.words.join(" ");
    this.words = [];
    return text;
  }

  cancel() {
    this.listening = false;
    this.words = [];
  }

  dispose() {
    this.cancel();
    this.events = null;
  }
}
