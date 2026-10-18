/**
 * Segmentation works in two stages so that no stage can ever alter the text:
 *
 * 1. `splitIntoUnits` deterministically cuts the original into the smallest
 *    sensible pieces (sentences, or clauses of very long sentences), each an
 *    exact [start, end) span of the source.
 * 2. A grouping step (the AI on the server, or `groupUnitsHeuristically`
 *    locally) decides which consecutive units form one segment.
 *
 * Because segments are built from unit spans, the mapping back to the source
 * is exact by construction, and `validateSegmentation` double-checks it.
 */

import type { KeyPoint, Segment } from "../types";
import { uid, nowISO } from "../id";
import { extractKeyPointsHeuristically } from "../meaning/heuristics";
import { currentText } from "./operations";

export interface TextUnit {
  index: number;
  start: number;
  end: number;
  text: string;
  paragraphIndex: number;
  /** Index of the source line; units on different lines never share a segment. */
  lineIndex: number;
  wordCount: number;
}

export const TARGET_MIN_WORDS = 10;
export const TARGET_MAX_WORDS = 35;

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "eg", "ie", "e.g", "i.e",
  "a.m", "p.m", "am", "pm", "no", "approx", "dept", "est", "fig", "inc", "ltd", "co", "corp",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun", "ref", "re",
]);

export function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Shrink [start, end) so it has no leading/trailing whitespace. */
function trimSpan(text: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

/** Sentence boundaries (absolute offsets where the next sentence starts) within [start, end). */
function sentenceBreaks(text: string, start: number, end: number): number[] {
  const breaks: number[] = [];
  const slice = text.slice(start, end);
  // Terminal punctuation, optional closing quotes/brackets, then whitespace.
  const re = /([.!?…]+)(["'”’)\]]*)(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) {
    const punct = m[1];
    const nextStart = m.index + m[0].length;
    if (nextStart >= slice.length) break;
    const next = slice[nextStart];
    // The next sentence should begin like a sentence.
    if (!/[A-Z0-9"'“‘(\[À-ÖØ-Þ]/.test(next)) continue;
    if (punct === ".") {
      const before = slice.slice(0, m.index);
      const token = (before.match(/([A-Za-z.]+)$/)?.[1] ?? "").toLowerCase();
      if (ABBREVIATIONS.has(token) || ABBREVIATIONS.has(token.replace(/\.$/, ""))) continue;
      // Single initials such as "J. Smith".
      if (/^[a-z]$/.test(token)) continue;
    }
    breaks.push(start + nextStart);
  }
  return breaks;
}

const CLAUSE_SPLIT =
  /(?:[;:]\s+|\s+[—–]\s+|,\s+(?=(?:and|but|so|because|which|although|though|while|whereas|or|however|unless|since|as well as|so that|especially|including|meaning|whereby)\b))/gi;

/** Split a long sentence span into clause spans, each ideally ≤ TARGET_MAX_WORDS. */
function splitLongSentence(text: string, start: number, end: number): Array<[number, number]> {
  const words = countWords(text.slice(start, end));
  if (words <= TARGET_MAX_WORDS) return [[start, end]];
  const slice = text.slice(start, end);
  const candidates: number[] = [];
  let m: RegExpExecArray | null;
  CLAUSE_SPLIT.lastIndex = 0;
  while ((m = CLAUSE_SPLIT.exec(slice))) {
    // Split after the punctuation (keep it with the left clause).
    const pos = m.index + m[0].length;
    // Keep "and"/"but" with the clause they introduce: the cut is before the word.
    candidates.push(start + pos);
  }
  // Choose the candidate closest to the middle that leaves both halves ≥ 6 words.
  let best = -1;
  let bestScore = Infinity;
  for (const c of candidates) {
    const left = countWords(text.slice(start, c));
    const right = countWords(text.slice(c, end));
    if (left < 6 || right < 6) continue;
    const score = Math.abs(left - right);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best < 0) return [[start, end]];
  const [ls, le] = trimSpan(text, start, best);
  const [rs, re] = trimSpan(text, best, end);
  return [...splitLongSentence(text, ls, le), ...splitLongSentence(text, rs, re)];
}

export function splitIntoUnits(text: string): TextUnit[] {
  const units: TextUnit[] = [];
  let paragraphIndex = -1;
  let lineIndex = -1;
  let prevLineBlank = true;

  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const [ls, le] = trimSpan(text, lineStart, lineEnd);
    if (ls === le) {
      prevLineBlank = true;
    } else {
      if (prevLineBlank) paragraphIndex++;
      prevLineBlank = false;
      lineIndex++;
      const bounds = [ls, ...sentenceBreaks(text, ls, le), le];
      for (let i = 0; i < bounds.length - 1; i++) {
        const [ss, se] = trimSpan(text, bounds[i], bounds[i + 1]);
        if (ss === se) continue;
        for (const [cs, ce] of splitLongSentence(text, ss, se)) {
          const t = text.slice(cs, ce);
          units.push({
            index: units.length,
            start: cs,
            end: ce,
            text: t,
            paragraphIndex,
            lineIndex,
            wordCount: countWords(t),
          });
        }
      }
    }
    if (lineEnd === text.length) break;
    lineStart = lineEnd + 1;
  }
  return units;
}

/** Groups are arrays of consecutive unit indices. */
export type UnitGrouping = number[][];

export function groupUnitsHeuristically(units: TextUnit[]): UnitGrouping {
  const groups: UnitGrouping = [];
  let current: number[] = [];
  let currentWords = 0;
  for (const u of units) {
    const prev = current.length ? units[current[current.length - 1]] : null;
    const sameLine = prev !== null && prev.lineIndex === u.lineIndex;
    const canMerge =
      sameLine &&
      (currentWords < TARGET_MIN_WORDS || u.wordCount < 5) &&
      currentWords + u.wordCount <= 30;
    if (current.length && !canMerge) {
      groups.push(current);
      current = [];
      currentWords = 0;
    }
    current.push(u.index);
    currentWords += u.wordCount;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** A grouping is valid if it covers every unit exactly once, in order, without crossing lines. */
export function isValidGrouping(units: TextUnit[], groups: UnitGrouping): boolean {
  let expected = 0;
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return false;
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== expected) return false;
      if (i > 0 && units[g[i]].lineIndex !== units[g[i - 1]].lineIndex) return false;
      expected++;
    }
  }
  return expected === units.length;
}

const MAX_GROUP_WORDS = TARGET_MAX_WORDS;

function overlapScore(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9£$€]+/g) ?? []);
  const A = words(a);
  let n = 0;
  words(b).forEach((w) => A.has(w) && n++);
  return n;
}

/**
 * Make a model-proposed grouping satisfy the hard rules without discarding it:
 * groups are split where they cross a line break or run far past the word
 * target, and each key point follows the sub-group it talks about. Returns
 * null if the grouping is unusable (missing, duplicated or reordered units).
 */
export function repairGrouping(
  units: TextUnit[],
  groups: UnitGrouping,
  keyPoints: KeyPoint[][],
): { groups: UnitGrouping; keyPoints: KeyPoint[][] } | null {
  const flat = groups.flat();
  if (flat.length !== units.length || flat.some((u, i) => u !== i)) return null;
  const outGroups: UnitGrouping = [];
  const outKeys: KeyPoint[][] = [];
  groups.forEach((g, gi) => {
    // 1. Split at line boundaries.
    const byLine: number[][] = [];
    for (const u of g) {
      const last = byLine[byLine.length - 1];
      if (last && units[last[last.length - 1]].lineIndex === units[u].lineIndex) last.push(u);
      else byLine.push([u]);
    }
    // 2. Split oversized groups greedily at unit boundaries.
    const parts: number[][] = [];
    for (const lg of byLine) {
      let cur: number[] = [];
      let words = 0;
      for (const u of lg) {
        if (cur.length && words + units[u].wordCount > MAX_GROUP_WORDS) {
          parts.push(cur);
          cur = [];
          words = 0;
        }
        cur.push(u);
        words += units[u].wordCount;
      }
      if (cur.length) parts.push(cur);
    }
    const texts = parts.map((p) => p.map((u) => units[u].text).join(" "));
    const keys: KeyPoint[][] = parts.map(() => []);
    for (const k of keyPoints[gi] ?? []) {
      let best = 0;
      texts.forEach((t, i) => {
        if (overlapScore(t, k.text) > overlapScore(texts[best], k.text)) best = i;
      });
      keys[best].push(k);
    }
    outGroups.push(...parts);
    outKeys.push(...keys);
  });
  return { groups: outGroups, keyPoints: outKeys };
}

export function buildSegments(
  text: string,
  units: TextUnit[],
  groups: UnitGrouping,
  keyPoints?: KeyPoint[][],
): Segment[] {
  const now = nowISO();
  return groups.map((g, i) => {
    const first = units[g[0]];
    const last = units[g[g.length - 1]];
    const originalText = text.slice(first.start, last.end);
    return {
      id: uid("seg"),
      start: first.start,
      end: last.end,
      originalText,
      paragraphIndex: first.paragraphIndex,
      keyPoints: keyPoints?.[i]?.length ? keyPoints[i] : extractKeyPointsHeuristically(originalText),
      status: "pending",
      revisions: [],
      currentRevisionId: null,
      check: null,
      updatedAt: now,
    };
  });
}

export function segmentHeuristically(text: string): Segment[] {
  const units = splitIntoUnits(text);
  return buildSegments(text, units, groupUnitsHeuristically(units));
}

export interface SegmentationProblem {
  segmentId?: string;
  message: string;
}

/** Verifies the exact source mapping: ordered, non-overlapping, exact text, full coverage. */
export function validateSegmentation(text: string, segments: Segment[]): SegmentationProblem[] {
  const problems: SegmentationProblem[] = [];
  let cursor = 0;
  for (const s of segments) {
    if (s.start < cursor) problems.push({ segmentId: s.id, message: "Segment overlaps or is out of order" });
    if (text.slice(s.start, s.end) !== s.originalText)
      problems.push({ segmentId: s.id, message: "Segment text does not match its source span" });
    const gap = text.slice(cursor, s.start);
    if (/\S/.test(gap)) problems.push({ segmentId: s.id, message: `Uncovered source text before segment: "${gap.trim()}"` });
    cursor = Math.max(cursor, s.end);
  }
  if (/\S/.test(text.slice(cursor))) problems.push({ message: "Text after the last segment is not covered" });
  return problems;
}

// ---------------------------------------------------------------------------
// User adjustments: merge and split. Both keep spans exact.
// ---------------------------------------------------------------------------

function joinRewrites(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  return [a, b].filter(Boolean).join(" ");
}

/** Merge segment `id` with the one after it. Rewrites are concatenated, never discarded. */
export function mergeWithNext(text: string, segments: Segment[], id: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || i >= segments.length - 1) return segments;
  const a = segments[i];
  const b = segments[i + 1];
  const now = nowISO();
  const combined = joinRewrites(currentText(a), currentText(b));
  const revisions = [...a.revisions, ...b.revisions];
  let currentRevisionId: string | null = null;
  if (combined) {
    const rev = { id: uid("rev"), text: combined, source: "merge" as const, createdAt: now };
    revisions.push(rev);
    currentRevisionId = rev.id;
  }
  const originalText = text.slice(a.start, b.end);
  const merged: Segment = {
    id: a.id,
    start: a.start,
    end: b.end,
    originalText,
    paragraphIndex: a.paragraphIndex,
    keyPoints: [...a.keyPoints, ...b.keyPoints],
    // A merged segment with any rewrite needs a fresh check of the combined meaning.
    status: combined ? "flagged" : "pending",
    revisions,
    currentRevisionId,
    check: null,
    updatedAt: now,
  };
  return [...segments.slice(0, i), merged, ...segments.slice(i + 2)];
}

/**
 * Split segment `id` at a character offset relative to its originalText.
 * The offset is snapped to the nearest whitespace so words are never cut.
 * Any existing rewrite is kept in the first half's history but both halves
 * return to pending, because a rewrite of the whole can't be split reliably.
 */
export function splitSegment(text: string, segments: Segment[], id: string, offset: number): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0) return segments;
  const s = segments[i];
  const local = s.originalText;
  let cut = Math.max(1, Math.min(local.length - 1, offset));
  // Snap to whitespace.
  if (!/\s/.test(local[cut])) {
    let l = cut;
    let r = cut;
    while (l > 0 && !/\s/.test(local[l])) l--;
    while (r < local.length && !/\s/.test(local[r])) r++;
    cut = cut - l <= r - cut ? l : r;
  }
  const [as, ae] = trimSpan(text, s.start, s.start + cut);
  const [bs, be] = trimSpan(text, s.start + cut, s.end);
  if (as === ae || bs === be) return segments;
  const now = nowISO();
  const first: Segment = {
    ...s,
    start: as,
    end: ae,
    originalText: text.slice(as, ae),
    keyPoints: extractKeyPointsHeuristically(text.slice(as, ae)),
    status: "pending",
    currentRevisionId: null,
    check: null,
    updatedAt: now,
  };
  const second: Segment = {
    id: uid("seg"),
    start: bs,
    end: be,
    originalText: text.slice(bs, be),
    paragraphIndex: s.paragraphIndex,
    keyPoints: extractKeyPointsHeuristically(text.slice(bs, be)),
    status: "pending",
    revisions: [],
    currentRevisionId: null,
    check: null,
    updatedAt: now,
  };
  return [...segments.slice(0, i), first, second, ...segments.slice(i + 1)];
}
