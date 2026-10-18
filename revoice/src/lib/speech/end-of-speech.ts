/**
 * Decides when an utterance has ended.
 *
 * Natural speech has pauses: a short breath shouldn't finish the segment.
 * The detector starts from a base silence threshold (default ~1.7 s) and,
 * when adaptive, learns from the user:
 *  - pauses they make mid-utterance and then resume (their "thinking pauses")
 *    raise the threshold so it sits comfortably above them;
 *  - a "false finish" (we ended the utterance but they kept talking) adds a
 *    permanent bump.
 */

export interface EndOfSpeechOptions {
  baseMs: number;
  adaptive: boolean;
  minMs?: number;
  maxMs?: number;
}

/** A pause shorter than this is just the gap between words. */
const PAUSE_MIN_MS = 450;

export class PauseProfile {
  private pauses: number[] = [];
  falseFinishBumpMs = 0;

  record(ms: number) {
    this.pauses.push(ms);
    if (this.pauses.length > 60) this.pauses.shift();
  }

  /** 90th percentile of observed mid-utterance pauses, or 0 with too little data. */
  p90(): number {
    if (this.pauses.length < 3) return 0;
    const sorted = [...this.pauses].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  }

  reportFalseFinish() {
    this.falseFinishBumpMs = Math.min(this.falseFinishBumpMs + 400, 1600);
  }

  get sampleCount() {
    return this.pauses.length;
  }
}

export class EndOfSpeechDetector {
  private lastActivity = 0;
  private started = false;
  private readonly minMs: number;
  private readonly maxMs: number;

  constructor(
    private readonly opts: EndOfSpeechOptions,
    private readonly profile: PauseProfile = new PauseProfile(),
  ) {
    this.minMs = opts.minMs ?? 1000;
    this.maxMs = opts.maxMs ?? 4500;
  }

  /** Current silence needed to end the utterance. */
  threshold(): number {
    let t = this.opts.baseMs;
    if (this.opts.adaptive) {
      const p90 = this.profile.p90();
      if (p90) t = Math.max(t, p90 * 1.2 + 250);
      t += this.profile.falseFinishBumpMs;
    }
    return Math.round(Math.min(this.maxMs, Math.max(this.minMs, t)));
  }

  activity(now: number) {
    if (this.started) {
      const gap = now - this.lastActivity;
      // They paused, then resumed: that pause was not the end.
      if (gap >= PAUSE_MIN_MS && gap < this.threshold()) this.profile.record(gap);
    }
    this.started = true;
    this.lastActivity = now;
  }

  get hasSpeech() {
    return this.started;
  }

  silenceMs(now: number): number {
    return this.started ? now - this.lastActivity : 0;
  }

  shouldFinish(now: number): boolean {
    return this.started && now - this.lastActivity >= this.threshold();
  }

  reset() {
    this.started = false;
    this.lastActivity = 0;
  }
}
