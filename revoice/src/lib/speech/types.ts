/**
 * Speech recognition is behind this interface so providers can be swapped
 * without touching the UI. A provider handles one utterance at a time:
 * `start` → partial results → `finish` (or `cancel`).
 *
 * End-of-speech detection is NOT the provider's job; the provider reports
 * activity and the EndOfSpeechDetector decides when the user is done.
 */

export type SpeechErrorKind =
  | "unsupported"
  | "permission-denied"
  | "no-microphone"
  | "network"
  | "service"
  | "interrupted";

export class SpeechError extends Error {
  constructor(
    readonly kind: SpeechErrorKind,
    message: string,
    /** Whether the provider can carry on (true) or the session must stop (false). */
    readonly recoverable = false,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

export interface SpeechEvents {
  /** The full text heard so far in this utterance (final + interim). */
  onPartial(text: string): void;
  /** The user is audibly speaking right now. Drives silence detection. */
  onActivity(): void;
  /** Input level 0..1 for the waveform. */
  onLevel?(level: number): void;
  onError(err: SpeechError): void;
}

export interface StartOptions {
  language: string;
  /** Spelling hints (e.g. names from the original). Never the original sentence itself. */
  hints?: string[];
}

export interface SpeechProvider {
  readonly id: "webspeech" | "openai" | "simulated";
  readonly label: string;
  /** Plain-language note about where audio goes, shown in the privacy notice. */
  readonly privacyNote: string;
  isSupported(): boolean;
  start(events: SpeechEvents, opts: StartOptions): Promise<void>;
  /** Stop listening and resolve with the final transcript of this utterance. */
  finish(): Promise<string>;
  /** Stop listening and discard the utterance. */
  cancel(): void;
  /** Release the microphone completely. */
  dispose(): void;
}
