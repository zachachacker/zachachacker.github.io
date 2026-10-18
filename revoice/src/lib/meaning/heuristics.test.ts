import { describe, expect, it } from "vitest";
import { extractNumbers, heuristicCheck } from "./heuristics";
import { minimalCleanup } from "./cleanup";

describe("extractNumbers", () => {
  it("reads digits, currency and number words", () => {
    const v = (s: string) => extractNumbers(s).map((n) => n.value);
    expect(v("It costs £2,400 now")).toEqual([2400]);
    expect(v("two thousand four hundred pounds")).toEqual([2400]);
    expect(v("twenty-five people")).toEqual([25]);
    expect(v("about 2.5k")).toEqual([2500]);
    expect(v("the one I sent")).toEqual([]);
  });
});

describe("heuristicCheck (offline checker)", () => {
  it("accepts a free rephrasing with no concrete details", () => {
    const c = heuristicCheck(
      "I would be grateful if we could arrange a meeting to discuss this further.",
      "Could we have a meeting to talk about this?",
    );
    expect(c.issues.filter((i) => i.severity === "important")).toEqual([]);
    expect(c.source).toBe("heuristic");
  });

  it("flags a changed number", () => {
    const c = heuristicCheck("The revised budget now comes to £2,400.", "The new budget is now 2,500 pounds.");
    expect(c.verdict).toBe("meaning_changed");
    expect(c.issues[0].kind).toBe("number_changed");
  });

  it("accepts a number said in words", () => {
    const c = heuristicCheck("The revised budget now comes to £2,400.", "The budget's now two thousand four hundred quid.");
    expect(c.issues.filter((i) => i.kind === "number_changed" || i.kind === "missing_detail" && i.severity === "important")).toEqual([]);
  });

  it("flags an accidentally reversed negation", () => {
    const c = heuristicCheck(
      "Please note that I will not be able to start before 14 September.",
      "Just so you know I'll be able to start before the 14th of September.",
    );
    expect(c.issues.some((i) => i.kind === "negation_reversed" && i.severity === "important")).toBe(true);
  });

  it("flags a missing date and a missing name", () => {
    const c = heuristicCheck("I am available on Thursday or Friday afternoon to meet Dr. Patel.", "I'm free Thursday afternoon.");
    const details = c.issues.map((i) => i.detail).join(" ");
    expect(details).toContain("friday");
    expect(details).toContain("Patel");
  });
});

describe("minimalCleanup", () => {
  it("only fixes capitalisation, punctuation and fillers", () => {
    expect(minimalCleanup("um i honestly found the difference massive", { removeFillers: true })).toBe(
      "I honestly found the difference massive.",
    );
  });
  it("keeps fillers when disabled and never changes words", () => {
    expect(minimalCleanup("um yeah it was like really good", { removeFillers: false })).toBe("Um yeah it was like really good.");
  });
  it("mirrors a greeting's comma and adds question marks", () => {
    expect(minimalCleanup("hi doctor patel", { removeFillers: true, original: "Hi Dr. Patel," })).toBe("Hi doctor patel,");
    expect(minimalCleanup("could we meet on friday", { removeFillers: true })).toBe("Could we meet on friday?");
  });
  it("doesn't punctuate a line the original left unpunctuated", () => {
    expect(minimalCleanup("sam", { removeFillers: true, original: "Sam" })).toBe("Sam");
  });
  it("removes stutters but keeps legitimate doubles", () => {
    expect(minimalCleanup("I I think that that's fine", { removeFillers: true })).toBe("I think that that's fine.");
  });
});

describe("joinSpoken", async () => {
  const { joinSpoken } = await import("./cleanup");
  it("continues a sentence said in two goes", () => {
    expect(joinSpoken("Could we set up a meeting?", "to talk about it")).toBe("Could we set up a meeting to talk about it");
    expect(joinSpoken("could we set up a meeting", "to talk about it")).toBe("could we set up a meeting to talk about it");
  });
  it("keeps a new sentence separate", () => {
    expect(joinSpoken("My mum agrees with me.", "She's happy to talk.")).toBe("My mum agrees with me. She's happy to talk.");
  });
});
