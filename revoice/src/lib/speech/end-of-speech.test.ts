import { describe, expect, it } from "vitest";
import { EndOfSpeechDetector, PauseProfile } from "./end-of-speech";

describe("EndOfSpeechDetector", () => {
  it("does not finish before any speech", () => {
    const d = new EndOfSpeechDetector({ baseMs: 1700, adaptive: false });
    expect(d.shouldFinish(100_000)).toBe(false);
  });

  it("tolerates natural pauses shorter than the threshold", () => {
    const d = new EndOfSpeechDetector({ baseMs: 1700, adaptive: false });
    d.activity(0);
    expect(d.shouldFinish(1200)).toBe(false);
    d.activity(1300); // resumed after a 1.3 s pause
    expect(d.shouldFinish(2900)).toBe(false);
    expect(d.shouldFinish(3000)).toBe(true);
  });

  it("adapts to a user who pauses for long stretches mid-sentence", () => {
    const profile = new PauseProfile();
    const d = new EndOfSpeechDetector({ baseMs: 1700, adaptive: true }, profile);
    let t = 0;
    d.activity(t);
    for (let i = 0; i < 6; i++) {
      t += 1600; // long thinking pauses, each just under the threshold
      d.activity(t);
    }
    expect(d.threshold()).toBeGreaterThan(1700 * 1.1);
    // A 1.75 s pause no longer ends the utterance.
    expect(d.shouldFinish(t + 1750)).toBe(false);
  });

  it("learns from false finishes and stays within bounds", () => {
    const profile = new PauseProfile();
    const d = new EndOfSpeechDetector({ baseMs: 1700, adaptive: true }, profile);
    profile.reportFalseFinish();
    expect(d.threshold()).toBe(2100);
    for (let i = 0; i < 10; i++) profile.reportFalseFinish();
    expect(d.threshold()).toBeLessThanOrEqual(4500);
  });
});
