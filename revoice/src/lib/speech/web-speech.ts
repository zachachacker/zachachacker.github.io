/**
 * Browser speech recognition (Web Speech API).
 *
 * Supported in Chrome, Edge and Safari. Not in Firefox. In Chrome, audio is
 * sent to Google's speech service for recognition; Revoice itself stores no
 * audio.
 *
 * With `refine` on, the utterance is also recorded locally and, when it ends,
 * re-transcribed by OpenAI's speech model: the browser recogniser gives the
 * instant word-by-word text, OpenAI gives the more accurate final text.
 */

import { api } from "../api/client";
import { openMicrophone } from "./audio-level";
import { SpeechError, type SpeechEvents, type SpeechProvider, type StartOptions } from "./types";

/**
 * Join recogniser results into one string. Chrome on Android repeats earlier
 * text in each new result ("hello" / "hello how" / "hello how are you"), and
 * desktop Chrome sometimes omits the space between results; both are handled.
 */
export function mergeResults(transcripts: string[]): string {
  let acc = "";
  for (const raw of transcripts) {
    const t = raw.trim();
    if (!t) continue;
    const a = acc.toLowerCase();
    const b = t.toLowerCase();
    if (!acc || b.startsWith(a)) acc = t; // cumulative result replaces what we had
    else if (a.endsWith(b) && b.split(" ").length >= 3) continue; // a whole phrase sent twice
    else acc = `${acc} ${t}`;
  }
  return acc.replace(/\s+/g, " ").trim();
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/**
 * Accept the refined transcript only if it is plausibly the same utterance:
 * guards against the rare hallucinated or truncated transcription.
 */
export function plausibleRefinement(live: string, refined: string): boolean {
  const lw = words(live);
  const rw = words(refined);
  if (!rw.length) return false;
  if (lw.length < 3) return true;
  if (rw.length < lw.length * 0.75 || rw.length > lw.length * 1.6 + 3) return false;
  const set = new Set(rw);
  const shared = lw.filter((w) => set.has(w)).length;
  return shared / lw.length >= 0.4;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) if (MediaRecorder.isTypeSupported(t)) return t;
  return undefined;
}

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
  readonly label: string;
  readonly privacyNote: string;
  private readonly refine: boolean;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private generation = 0;

  constructor(opts: { refine?: boolean } = {}) {
    this.refine = !!opts.refine && typeof MediaRecorder !== "undefined";
    this.label = this.refine ? "Browser speech + OpenAI accuracy" : "Browser speech recognition";
    this.privacyNote = this.refine
      ? "Your browser shows your words live (Chrome and Edge send audio to Google/Microsoft for this). When you finish a line, its audio is sent through the Revoice server to OpenAI for an accurate transcript, then discarded."
      : "Your browser's built-in recogniser converts speech to text. In Chrome and Edge this sends audio to Google/Microsoft speech services. Revoice does not record or keep audio.";
  }

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
    this.restarts = 0;
    const gen = ++this.generation;
    // Start recording before recognition so the first word is in both.
    if (this.refine) await this.startRecorder();
    if (gen !== this.generation) return;
    this.active = true;
    this.spawn(Ctor);
  }

  private async startRecorder() {
    try {
      if (!this.stream || this.stream.getAudioTracks().every((t) => t.readyState === "ended")) {
        this.stream = await openMicrophone();
      }
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
      this.chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      rec.start(250);
      this.recorder = rec;
    } catch {
      // Refinement is an extra; live recognition still works without it.
      this.recorder = null;
    }
  }

  private async stopRecorder(): Promise<Blob | null> {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec || rec.state === "inactive") return null;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    const blob = this.chunks.length ? new Blob(this.chunks, { type: this.chunks[0].type }) : null;
    this.chunks = [];
    return blob;
  }

  private async refineText(live: string, blob: Blob): Promise<string> {
    const form = new FormData();
    form.append("audio", blob, blob.type.includes("mp4") ? "utterance.mp4" : "utterance.webm");
    form.append("language", (this.opts?.language ?? "en").slice(0, 2));
    if (this.opts?.hints?.length) form.append("prompt", this.opts.hints.join(", "));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await api.transcribe(form, ctrl.signal);
    clearTimeout(timer);
    if (!res.ok) return live;
    let refined = res.data.text.trim();
    if (!plausibleRefinement(live, refined)) return live;
    // The transcriber capitalises as if every clip starts a sentence; keep the live casing of the first word.
    const lw = live.split(/\s+/)[0];
    const rw = refined.split(/\s+/)[0];
    if (lw && rw && lw !== "i" && /^[a-z]/.test(lw) && rw.toLowerCase().replace(/[^a-z']/g, "") === lw.toLowerCase()) {
      refined = refined[0].toLowerCase() + refined.slice(1);
    }
    return refined;
  }

  private text() {
    return mergeResults([this.committed, this.current]);
  }

  private spawn(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = this.opts?.language ?? "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (this.rec !== rec || !this.active) return;
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript);
      const prev = this.text();
      this.current = mergeResults(parts);
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
    const gen = ++this.generation;
    const blob = await this.stopRecorder();
    if (!text || !blob || gen !== this.generation) return text;
    return this.refineText(text, blob);
  }

  cancel() {
    this.generation++;
    this.stopRecognition();
    void this.stopRecorder();
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.events = null;
  }
}
