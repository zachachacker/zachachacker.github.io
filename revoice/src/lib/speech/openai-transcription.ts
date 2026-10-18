/**
 * Server-side transcription via OpenAI (works in any browser with
 * MediaRecorder, including Firefox). Audio is recorded locally, sent to the
 * Revoice server, forwarded to OpenAI, and discarded.
 *
 * There is no streaming recogniser, so live text is produced by re-transcribing
 * the utterance-so-far every few seconds while the user speaks, and activity
 * comes from the voice-activity detector.
 */

import { api } from "../api/client";
import { openMicrophone, startLevelMeter } from "./audio-level";
import { SpeechError, type SpeechEvents, type SpeechProvider, type StartOptions } from "./types";

const INTERIM_EVERY_MS = 2500;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export class OpenAITranscriptionProvider implements SpeechProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI transcription";
  readonly privacyNote =
    "Each spoken segment is recorded in your browser, sent to the Revoice server and on to OpenAI for transcription, then discarded. Nothing is stored.";

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopMeter: (() => void) | null = null;
  private interimTimer: number | null = null;
  private events: SpeechEvents | null = null;
  private opts: StartOptions | null = null;
  private heardVoice = false;
  private voiceSinceInterim = false;
  private generation = 0;
  private lastPartial = "";

  isSupported() {
    return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  async start(events: SpeechEvents, opts: StartOptions) {
    if (!this.isSupported()) throw new SpeechError("unsupported", "This browser can't record audio.");
    this.cancel();
    this.events = events;
    this.opts = opts;
    const gen = ++this.generation;
    if (!this.stream || this.stream.getAudioTracks().every((t) => t.readyState === "ended")) {
      try {
        this.stream = await openMicrophone();
      } catch (e) {
        const name = (e as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError")
          throw new SpeechError("permission-denied", "Microphone access is blocked. Allow it in your browser's site settings, then try again.");
        throw new SpeechError("no-microphone", "No microphone was found, or it is in use by another app.");
      }
      this.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        this.events?.onError(new SpeechError("interrupted", "The microphone was disconnected. Your words so far are kept.", true));
      });
    }
    if (gen !== this.generation) return;
    this.chunks = [];
    this.heardVoice = false;
    this.lastPartial = "";
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    recorder.start(250);
    this.recorder = recorder;
    this.stopMeter = startLevelMeter(this.stream, {
      onLevel: (l) => this.events?.onLevel?.(l),
      onVoice: () => {
        this.heardVoice = true;
        this.voiceSinceInterim = true;
        this.events?.onActivity();
      },
    });
    this.interimTimer = window.setInterval(() => void this.interim(gen), INTERIM_EVERY_MS);
  }

  private form(blob: Blob): FormData {
    const f = new FormData();
    const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
    f.append("audio", blob, `utterance.${ext}`);
    f.append("language", (this.opts?.language ?? "en").slice(0, 2));
    if (this.opts?.hints?.length) f.append("prompt", this.opts.hints.join(", "));
    return f;
  }

  private async interim(gen: number) {
    if (!this.voiceSinceInterim || !this.chunks.length) return;
    this.voiceSinceInterim = false;
    const blob = new Blob(this.chunks, { type: this.chunks[0].type });
    const res = await api.transcribe(this.form(blob));
    if (gen !== this.generation || !res.ok) return;
    const text = res.data.text.trim();
    if (text && text !== this.lastPartial) {
      this.lastPartial = text;
      this.events?.onPartial(text);
    }
  }

  private teardown() {
    if (this.interimTimer !== null) window.clearInterval(this.interimTimer);
    this.interimTimer = null;
    this.stopMeter?.();
    this.stopMeter = null;
  }

  async finish(): Promise<string> {
    const gen = ++this.generation;
    const recorder = this.recorder;
    this.recorder = null;
    this.teardown();
    if (!recorder) return this.lastPartial;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    if (!this.heardVoice || !this.chunks.length) return "";
    const blob = new Blob(this.chunks, { type: this.chunks[0].type });
    this.chunks = [];
    const res = await api.transcribe(this.form(blob));
    if (gen !== this.generation) return "";
    if (!res.ok) {
      // Fall back to the last live result rather than losing the utterance.
      if (this.lastPartial) return this.lastPartial;
      throw new SpeechError("network", "Couldn't reach the transcription service. Type your version, or try again.", true);
    }
    return res.data.text.trim();
  }

  cancel() {
    this.generation++;
    this.teardown();
    const r = this.recorder;
    this.recorder = null;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    this.chunks = [];
  }

  dispose() {
    this.cancel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.events = null;
  }
}
