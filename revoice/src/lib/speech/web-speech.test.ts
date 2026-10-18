import { describe, expect, it } from "vitest";
import { mergeResults, plausibleRefinement } from "./web-speech";
import { migrateSettings } from "../storage/store";
import { DEFAULT_SETTINGS } from "../types";

describe("mergeResults", () => {
  it("joins desktop Chrome results with spaces", () => {
    expect(mergeResults(["could we", " meet on", "friday"])).toBe("could we meet on friday");
  });
  it("collapses Android-style cumulative results instead of repeating them", () => {
    expect(mergeResults(["could", "could we", "could we meet on friday"])).toBe("could we meet on friday");
  });
  it("drops a whole phrase sent twice but keeps short legitimate repeats", () => {
    expect(mergeResults(["I can make it on friday", "make it on friday"])).toBe("I can make it on friday");
    expect(mergeResults(["I said no", "no"])).toBe("I said no no");
  });
});

describe("plausibleRefinement", () => {
  it("accepts a corrected transcript of the same utterance", () => {
    expect(plausibleRefinement("I'm free thursday or fry day afternoon", "I'm free Thursday or Friday afternoon.")).toBe(true);
  });
  it("rejects a hallucinated or truncated transcript", () => {
    expect(plausibleRefinement("could we set up a meeting to talk about it", "Thank you.")).toBe(false);
    expect(plausibleRefinement("could we set up a meeting to talk about it", "Please subscribe to my channel for more videos")).toBe(false);
  });
});

describe("migrateSettings", () => {
  it("moves untouched old timing defaults to the new ones", () => {
    const s = migrateSettings({ silenceMs: 1700, transitionDelayMs: 700, privacyNoticeSeen: true });
    expect(s.silenceMs).toBe(DEFAULT_SETTINGS.silenceMs);
    expect(s.transitionDelayMs).toBe(DEFAULT_SETTINGS.transitionDelayMs);
    expect(s.privacyNoticeSeen).toBe(true);
  });
  it("keeps values the user chose", () => {
    const s = migrateSettings({ silenceMs: 3000, transitionDelayMs: 400 });
    expect(s.silenceMs).toBe(3000);
    expect(s.transitionDelayMs).toBe(400);
  });
});
