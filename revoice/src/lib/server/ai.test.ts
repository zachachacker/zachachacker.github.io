import { describe, expect, it } from "vitest";
import { sanitizeCheck, sanitizeReview } from "./ai";

describe("sanitizeCheck", () => {
  it("derives the verdict from the issues so they can't disagree", () => {
    const r = sanitizeCheck(
      { verdict: "preserved", issues: [{ kind: "negation_reversed", severity: "important", detail: "You can't start before 14 September.", explanation: "x" }], suggestions: [] },
      "I can start before the 14th.",
      "minimal",
    );
    expect(r.verdict).toBe("meaning_changed");
  });

  it("drops suggestions that don't apply to the user's text", () => {
    const r = sanitizeCheck(
      {
        verdict: "preserved",
        issues: [],
        suggestions: [
          { from: "fry day", to: "Friday", reason: "mis-heard" },
          { from: "not in text", to: "x", reason: "bad" },
          { from: "same", to: "same", reason: "no-op" },
        ],
      },
      "I'm free fry day, same as before",
      "minimal",
    );
    expect(r.suggestions.map((s) => s.to)).toEqual(["Friday"]);
  });
});

describe("sanitizeReview", () => {
  const req = {
    title: "t",
    original: "o",
    segments: [{ id: "a", original: "x", rewrite: "Thanks so much. Thanks so much.", status: "completed" as const }],
  };
  it("keeps valid fixes, including deletions, and drops ones that don't apply", () => {
    const r = sanitizeReview(
      {
        findings: [
          { kind: "repetition", category: "meaning", segmentIds: ["a", "ghost"], explanation: "Said twice.", fix: { segmentId: "a", from: " Thanks so much.", to: "" } },
          { kind: "meaning_change", category: "meaning", segmentIds: ["a"], explanation: "Bad fix.", fix: { segmentId: "a", from: "nowhere", to: "x" } },
          { kind: "optional_improvement", category: "meaning", segmentIds: [], explanation: "Style.", fix: null },
        ],
      },
      req,
    );
    expect(r.findings[0].fix).not.toBeNull();
    expect(r.findings[0].segmentIds).toEqual(["a"]);
    expect(r.findings[1].fix).toBeNull();
    expect(r.findings[2].category).toBe("optional");
  });
});
