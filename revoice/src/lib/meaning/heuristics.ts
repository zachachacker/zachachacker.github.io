/**
 * Local, rule-based meaning checks.
 *
 * This is NOT an AI and does not pretend to understand paraphrase. It is used
 * when the AI is disabled, unconfigured or unreachable, and it is always
 * labelled "offline check" in the UI. It only verifies things that can be
 * checked mechanically and reliably: numbers, names, dates/times and
 * negations. Anything else is left to the AI check or to the user.
 */

import type { KeyPoint, MeaningCheck, MeaningIssue, IssueKind } from "../types";
import { uid, nowISO } from "../id";

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
];
const RELATIVE_DAYS = ["today", "tomorrow", "yesterday", "tonight", "weekend", "fortnight"];

const NEGATION_RE =
  /\b(not|no|never|none|nobody|nothing|nowhere|neither|nor|without|cannot|can't|cant|won't|wont|don't|dont|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|shouldn't|shouldnt|wouldn't|wouldnt|couldn't|couldnt|haven't|havent|hasn't|hasnt|hadn't|hadnt|mustn't|mustnt|unable|refuse|refused|decline|declined)\b|n['’]t\b/gi;

/** Words that start with a capital letter for reasons other than being names. */
const NON_NAME_CAPS = new Set([
  "i", "i'm", "i'll", "i've", "i'd", "hi", "hello", "dear", "hey", "thanks", "thank", "best",
  "regards", "kind", "warm", "cheers", "sincerely", "yours", "please", "ok", "okay",
  ...WEEKDAYS, ...MONTHS,
]);

const FUNCTION_WORDS = new Set(
  (
    "a an the and or but so to of in on at by for with from as is are was were be been being am " +
    "it its this that these those there here i me my mine we us our you your he him his she her they them " +
    "their do does did have has had will would shall should can could may might must just very really " +
    "also too if then than about into over under again more most some any such only own same other " +
    "what which who whom when where why how all each both few up down out off now"
  ).split(" "),
);

export interface ExtractedNumber {
  value: number;
  raw: string;
}

function parseNumeric(raw: string): number | null {
  let s = raw.toLowerCase().replace(/[£$€,\s]/g, "").replace(/(st|nd|rd|th|%|percent)$/, "");
  let mult = 1;
  if (/k$/.test(s)) {
    mult = 1000;
    s = s.slice(0, -1);
  } else if (/m$/.test(s)) {
    mult = 1_000_000;
    s = s.slice(0, -1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

/** Extract numbers written as digits or as English number words. */
export function extractNumbers(text: string, opts: { includeOrdinalWords?: boolean; includeOne?: boolean } = {}): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  // Digits, with optional currency, thousands separators, decimals, ordinal or k/m suffix.
  const digitRe = /[£$€]?\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th|k|m|%)?/gi;
  let m: RegExpExecArray | null;
  while ((m = digitRe.exec(text))) {
    const v = parseNumeric(m[0]);
    if (v !== null) out.push({ value: v, raw: m[0] });
  }
  // Number words: greedy runs like "two thousand five hundred", "twenty-five".
  const tokens = text.toLowerCase().replace(/-/g, " ").match(/[a-z']+/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (opts.includeOrdinalWords && t in ORDINALS) {
      out.push({ value: ORDINALS[t], raw: t });
      i++;
      continue;
    }
    const startsNumber = t in UNITS || t in TENS || (t in SCALES && tokens[i - 1] === "a");
    if (!startsNumber) {
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    const rawParts: string[] = [];
    if (t in SCALES) current = 1; // "a hundred"
    while (i < tokens.length) {
      const w = tokens[i];
      if (w in UNITS) current += UNITS[w];
      else if (w in TENS) current += TENS[w];
      else if (w in SCALES) {
        current = (current || 1) * SCALES[w];
        if (SCALES[w] >= 1000) {
          total += current;
          current = 0;
        }
      } else if (w === "and" && rawParts.length && (tokens[i + 1] in UNITS || tokens[i + 1] in TENS)) {
        // "two hundred and fifty"
      } else break;
      rawParts.push(w);
      i++;
    }
    const raw = rawParts.join(" ");
    const value = total + current;
    if (raw === "one" && !opts.includeOne) continue; // "one" is usually a pronoun
    out.push({ value, raw });
  }
  return out;
}

export function extractDateTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const w of [...WEEKDAYS, ...MONTHS, ...RELATIVE_DAYS]) {
    // "may" is too ambiguous as a modal verb unless capitalised in the source.
    if (w === "may" && !/\bMay\b/.test(text)) continue;
    if (new RegExp(`\\b${w}s?\\b`).test(lower)) found.add(w);
  }
  if (/\bnext week\b/.test(lower)) found.add("next week");
  if (/\bthis week\b/.test(lower)) found.add("this week");
  if (/\bnext month\b/.test(lower)) found.add("next month");
  return [...found];
}

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "dame", "st"]);

export function extractNames(text: string): string[] {
  const names = new Set<string>();
  // Capitalised words that aren't at the start of a sentence or line.
  let sentenceStart = true;
  for (const m of text.matchAll(/\S+|\n/g)) {
    const tok = m[0];
    if (tok === "\n") {
      sentenceStart = true;
      continue;
    }
    const word = tok.replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z'’-]+$/, "").replace(/['’]s$/, "");
    const bare = word.toLowerCase();
    if (/^[A-Z]/.test(word) && !sentenceStart && !NON_NAME_CAPS.has(bare) && !TITLES.has(bare)) names.add(word);
    // Titles like "Dr." end with a full stop but don't end the sentence.
    sentenceStart = /[.!?:]["'”’)]*$/.test(tok) && !TITLES.has(bare);
  }
  return [...names];
}

export function countNegations(text: string): number {
  return (text.match(NEGATION_RE) ?? []).length;
}

function hasCondition(text: string): boolean {
  return /\b(if|unless|provided|as long as|assuming|in case|only when)\b/i.test(text);
}

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 2 && !FUNCTION_WORDS.has(w));
}

export function extractKeyPointsHeuristically(text: string): KeyPoint[] {
  const points: KeyPoint[] = [];
  for (const n of extractNumbers(text)) points.push({ kind: "number", text: n.raw });
  for (const d of extractDateTokens(text)) points.push({ kind: "date", text: d });
  for (const name of extractNames(text)) points.push({ kind: "name", text: name });
  const neg = text.match(NEGATION_RE);
  if (neg) points.push({ kind: "negation", text: `Says "${neg[0]}"` });
  if (hasCondition(text)) points.push({ kind: "condition", text: "Contains a condition" });
  if (/\b(could you|would you|can you|please|i'd like|we'd like|i would like|would it be possible|can we|could we)\b/i.test(text))
    points.push({ kind: "request", text: "Makes a request" });
  if (/\b(i will|i'll|we will|we'll|i promise|i can confirm|i commit|we commit)\b/i.test(text))
    points.push({ kind: "commitment", text: "Makes a commitment" });
  return points;
}

function issue(kind: IssueKind, severity: MeaningIssue["severity"], detail: string, explanation: string): MeaningIssue {
  return { id: uid("iss"), kind, severity, detail, explanation };
}

const CHANGED_KINDS: IssueKind[] = [
  "number_changed", "negation_reversed", "name_changed", "date_changed",
  "request_changed", "commitment_changed", "condition_changed", "added_claim",
];

export function verdictFor(issues: MeaningIssue[]): MeaningCheck["verdict"] {
  const important = issues.filter((i) => i.severity === "important");
  if (important.some((i) => CHANGED_KINDS.includes(i.kind))) return "meaning_changed";
  if (important.length) return "missing_detail";
  if (issues.length) return "minor_difference";
  return "preserved";
}

export function heuristicCheck(original: string, rewrite: string): MeaningCheck {
  const issues: MeaningIssue[] = [];

  // Numbers.
  const origNums = extractNumbers(original);
  const rewriteNums = extractNumbers(rewrite, { includeOrdinalWords: true, includeOne: true });
  const rewriteValues = new Set(rewriteNums.map((n) => n.value));
  const origValues = new Set(extractNumbers(original, { includeOrdinalWords: true, includeOne: true }).map((n) => n.value));
  const missingNums = origNums.filter((n) => !rewriteValues.has(n.value));
  const extraNums = extractNumbers(rewrite).filter((n) => !origValues.has(n.value));
  if (missingNums.length && extraNums.length) {
    issues.push(
      issue(
        "number_changed",
        "important",
        `The original says ${missingNums.map((n) => `“${n.raw}”`).join(", ")}.`,
        `Your version says ${extraNums.map((n) => `“${n.raw}”`).join(", ")} instead.`,
      ),
    );
  } else if (missingNums.length) {
    issues.push(
      issue(
        "missing_detail",
        "important",
        `The original mentions ${missingNums.map((n) => `“${n.raw}”`).join(", ")}.`,
        "That number doesn’t appear in your version.",
      ),
    );
  } else if (extraNums.length) {
    issues.push(
      issue(
        "added_claim",
        "important",
        `Your version mentions ${extraNums.map((n) => `“${n.raw}”`).join(", ")}.`,
        "That number isn’t in the original.",
      ),
    );
  }

  // Names.
  const rewriteLower = rewrite.toLowerCase();
  const missingNames = extractNames(original).filter((n) => !rewriteLower.includes(n.toLowerCase()));
  if (missingNames.length) {
    issues.push(
      issue(
        "missing_detail",
        "important",
        `The original mentions ${missingNames.join(", ")}.`,
        "That name doesn’t appear in your version. Ignore this if you referred to them another way.",
      ),
    );
  }

  // Dates and times.
  const origDates = extractDateTokens(original);
  const rewriteDates = extractDateTokens(rewrite);
  const missingDates = origDates.filter((d) => !rewriteDates.includes(d));
  const extraDates = rewriteDates.filter((d) => !origDates.includes(d));
  if (missingDates.length) {
    issues.push(
      issue(
        extraDates.length ? "date_changed" : "missing_detail",
        "important",
        `The original says “${missingDates.join(", ")}”.`,
        extraDates.length ? `Your version says “${extraDates.join(", ")}” instead.` : "That date or time isn’t in your version.",
      ),
    );
  }

  // Negation polarity: an odd/even mismatch is a strong hint of a reversed meaning.
  const origNeg = countNegations(original);
  const rewriteNeg = countNegations(rewrite);
  if ((origNeg > 0) !== (rewriteNeg > 0)) {
    issues.push(
      issue(
        "negation_reversed",
        "important",
        origNeg > 0 ? "The original is phrased as a negative (“not”, “never”, “no”…)." : "The original is phrased positively.",
        origNeg > 0
          ? "Your version has no negative, so it may say the opposite."
          : "Your version adds a negative, so it may say the opposite.",
      ),
    );
  }

  // Conditions are easy to drop by accident.
  if (hasCondition(original) && !hasCondition(rewrite)) {
    issues.push(issue("condition_changed", "minor", "The original includes a condition (“if”, “unless”…).", "Check your version keeps it."));
  }

  // A very short rewrite might be missing something, but paraphrase is legitimate, so it never blocks.
  const ow = contentWords(original).length;
  const rw = contentWords(rewrite).length;
  if (ow >= 6 && rw < ow * 0.35) {
    issues.push(issue("missing_detail", "minor", "Your version is much shorter than the original.", "Worth a glance to make sure nothing was left out."));
  }

  return {
    verdict: verdictFor(issues),
    issues,
    source: "heuristic",
    checkedText: rewrite,
    checkedAt: nowISO(),
  };
}
