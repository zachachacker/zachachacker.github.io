/**
 * Browser speech recognition (Web Speech API).
 *
 * Supported in Chrome, Edge and Safari. Not in Firefox. In Chrome, audio is
 * sent to Google's speech service for recognition; Revoice itself stores no
 * audio.
 */

import { SpeechError, type SpeechEvents, type SpeechProvider, type StartOptions } from "./types";

/* Minimal typings: the Web Speech API isn't in TypeScript's DOM lib. */
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SRErrorEvent { error: string }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class WebSpeechProvider implements SpeechProvider {
  readonly id = "webspeech" as const;
  readonly label = "Browser speech recognition";
  readonly privacyNote =
    "Your browser's built-in recogniser converts speech to text. In Chrome and Edge this sends audio to Google/Microsoft speech services. Revoice does not record or keep audio.";

  private rec: Recognition | null = null;
  private events: SpeechEvents | null = null;
  /** Text from earlier recogniser sessions in this utterance (Chrome ends sessions on its own). */
  private committed = "";
  private current = "";
  private active = false;
  private restarts = 0;
  private opts: StartOptions | null = null;

  isSupported() {
    return getCtor() !== null;
  }

  async start(events: SpeechEvents, opts: StartOptions) {
    const Ctor = getCtor();
    if (!Ctor) throw new SpeechError("unsupported", "This browser doesn't support speech recognition. Try Chrome or Edge, or switch to OpenAI transcription in Settings.");
    this.cancel();
    this.events = events;
    this.opts = opts;
    this.committed = "";
    this.current = "";
    this.active = true;
    this.restarts = 0;
    this.spawn(Ctor);
  }

  private text() {
    return [this.committed, this.current].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  private spawn(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = this.opts?.language ?? "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (this.rec !== rec || !this.active) return;
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      const prev = this.text();
      this.current = text.trim();
      const next = this.text();
      if (next !== prev) {
        this.events?.onActivity();
        this.events?.onPartial(next);
      }
    };
    rec.onspeechstart = () => {
      if (this.rec === rec && this.active) this.events?.onActivity();
    };
    rec.onerror = (e) => {
      if (this.rec !== rec || !this.active) return;
      switch (e.error) {
        case "no-speech":
        case "aborted":
          return; // onend will restart
        case "not-allowed":
        case "service-not-allowed":
          this.active = false;
          this.events?.onError(new SpeechError("permission-denied", "Microphone access is blocked. Allow it in your browser's site settings, then try again."));
          return;
        case "audio-capture":
          this.active = false;
          this.events?.onError(new SpeechError("no-microphone", "No microphone was found, or it is in use by another app."));
          return;
        case "network":
          this.active = false;
          this.events?.onError(new SpeechError("network", "The browser's speech service couldn't be reached. Check your connection, or switch to OpenAI transcription in Settings. Your work is saved.", true));
          return;
        default:
          this.active = false;
          this.events?.onError(new SpeechError("service", `Speech recognition stopped (${e.error}).`, true));
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      if (!this.active) return;
      // Chrome ends continuous sessions after silence or ~60 s. Keep listening.
      this.committed = this.text();
      this.current = "";
      if (++this.restarts > 50) {
        this.active = false;
        this.events?.onError(new SpeechError("interrupted", "Speech recognition kept stopping. Your words so far are kept.", true));
        return;
      }
      const Ctor = getCtor();
      if (Ctor) this.spawn(Ctor);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* start() throws if already started; harmless */
    }
  }

  async finish(): Promise<string> {
    const text = this.text();
    this.stopRecognition();
    return text;
  }

  cancel() {
    this.stopRecognition();
    this.committed = "";
    this.current = "";
  }

  private stopRecognition() {
    this.active = false;
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = null;
      rec.onspeechstart = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }

  dispose() {
    this.cancel();
    this.events = null;
  }
}
