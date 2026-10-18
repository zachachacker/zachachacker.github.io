import { describe, expect, it } from "vitest";
import { SAMPLE_EMAIL } from "@/test/fixtures";
import {
  splitIntoUnits, groupUnitsHeuristically, isValidGrouping, segmentHeuristically,
  validateSegmentation, mergeWithNext, splitSegment, countWords,
} from "./segmentation";

describe("splitIntoUnits", () => {
  it("maps every unit to an exact source span", () => {
    const units = splitIntoUnits(SAMPLE_EMAIL);
    for (const u of units) expect(SAMPLE_EMAIL.slice(u.start, u.end)).toBe(u.text);
  });

  it("does not split on abbreviations or initials", () => {
    const units = splitIntoUnits("Dr. Patel met J. Smith at 3 p.m. today. Then they left.");
    expect(units.map((u) => u.text)).toEqual(["Dr. Patel met J. Smith at 3 p.m. today.", "Then they left."]);
  });

  it("tracks paragraphs and lines", () => {
    const units = splitIntoUnits(SAMPLE_EMAIL);
    const signoff = units.filter((u) => u.text === "Best regards," || u.text === "Sam");
    expect(signoff).toHaveLength(2);
    expect(signoff[0].paragraphIndex).toBe(signoff[1].paragraphIndex);
    expect(signoff[0].lineIndex).not.toBe(signoff[1].lineIndex);
    expect(units[0].text).toBe("Hi Dr. Patel,");
    expect(units[0].paragraphIndex).toBe(0);
  });

  it("splits very long sentences at clause boundaries", () => {
    const long =
      "We reviewed the proposal in detail with the whole committee over several weeks, and we have concluded that the budget is reasonable for the scope described, but we would like to see a clearer timeline for the second phase before final approval is given by the board.";
    const units = splitIntoUnits(long);
    expect(units.length).toBeGreaterThan(1);
    for (const u of units) expect(u.wordCount).toBeLessThanOrEqual(35);
    expect(units.map((u) => u.text).join(" ")).toBe(long);
  });
});

describe("segmentation", () => {
  it("produces a valid, complete segmentation of a realistic email", () => {
    const segs = segmentHeuristically(SAMPLE_EMAIL);
    expect(validateSegmentation(SAMPLE_EMAIL, segs)).toEqual([]);
    expect(segs.length).toBeGreaterThan(5);
    for (const s of segs) expect(countWords(s.originalText)).toBeLessThanOrEqual(35);
  });

  it("never groups across line breaks", () => {
    const units = splitIntoUnits(SAMPLE_EMAIL);
    const groups = groupUnitsHeuristically(units);
    expect(isValidGrouping(units, groups)).toBe(true);
  });

  it("rejects invalid AI groupings", () => {
    const units = splitIntoUnits(SAMPLE_EMAIL);
    expect(isValidGrouping(units, [[0, 2]])).toBe(false); // gap + incomplete
    const all = units.map((u) => [u.index]);
    expect(isValidGrouping(units, all)).toBe(true);
    const lastTwo = [...all.slice(0, -2), [units.length - 2, units.length - 1]]; // "Best regards," + "Sam" on different lines
    expect(isValidGrouping(units, lastTwo)).toBe(false);
  });

  it("extracts key points such as numbers and names", () => {
    const segs = segmentHeuristically(SAMPLE_EMAIL);
    const budget = segs.find((s) => s.originalText.includes("£2,400"))!;
    expect(budget.keyPoints.some((k) => k.kind === "number" && k.text.includes("2,400"))).toBe(true);
  });
});

describe("merge and split", () => {
  it("merge keeps spans exact and joins rewrites", () => {
    let segs = segmentHeuristically(SAMPLE_EMAIL);
    const before = segs.length;
    segs = mergeWithNext(SAMPLE_EMAIL, segs, segs[1].id);
    expect(segs.length).toBe(before - 1);
    expect(validateSegmentation(SAMPLE_EMAIL, segs)).toEqual([]);
  });

  it("split snaps to a word boundary and keeps spans exact", () => {
    let segs = segmentHeuristically(SAMPLE_EMAIL);
    const target = segs.find((s) => countWords(s.originalText) > 10)!;
    segs = splitSegment(SAMPLE_EMAIL, segs, target.id, Math.floor(target.originalText.length / 2) + 1);
    expect(validateSegmentation(SAMPLE_EMAIL, segs)).toEqual([]);
    const i = segs.findIndex((s) => s.id === target.id);
    expect(segs[i].originalText + " " + segs[i + 1].originalText).toBe(target.originalText.replace(/\s+/g, " "));
  });
});

describe("repairGrouping", () => {
  it("splits groups that cross lines or run too long, keeping key points with their text", async () => {
    const { repairGrouping } = await import("./segmentation");
    const units = splitIntoUnits(SAMPLE_EMAIL);
    // One giant group per paragraph, as an over-eager model might return.
    const byPara = new Map<number, number[]>();
    units.forEach((u) => byPara.set(u.paragraphIndex, [...(byPara.get(u.paragraphIndex) ?? []), u.index]));
    const groups = [...byPara.values()];
    const keys = groups.map((g) => g.map((i) => ({ kind: "fact" as const, text: units[i].text })));
    const r = repairGrouping(units, groups, keys)!;
    expect(isValidGrouping(units, r.groups)).toBe(true);
    for (const g of r.groups) expect(g.reduce((n, i) => n + units[i].wordCount, 0)).toBeLessThanOrEqual(35);
    expect(r.keyPoints.flat()).toHaveLength(units.length);
    r.groups.forEach((g, gi) => r.keyPoints[gi].forEach((k) => expect(g.map((i) => units[i].text)).toContain(k.text)));
  });

  it("rejects groupings that lose or reorder units", async () => {
    const { repairGrouping } = await import("./segmentation");
    const units = splitIntoUnits("One two three. Four five six.");
    expect(repairGrouping(units, [[1], [0]], [[], []])).toBeNull();
    expect(repairGrouping(units, [[0]], [[]])).toBeNull();
  });
});
