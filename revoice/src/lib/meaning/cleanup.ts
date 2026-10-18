/**
 * The only automatic changes Revoice makes to what the user said.
 *
 * Permitted: capitalisation, punctuation, whitespace, and (when enabled)
 * removing filler sounds and immediate stutter repeats. Word choice, tone,
 * contractions and sentence structure are never touched here.
 */

const FILLERS = /(^|[\s,])(?:um+|uh+|erm+|er|uhm+|hmm+|mm+|ah+)(?=[\s,.!?]|$)[,]?/gi;

const QUESTION_STARTERS =
  /^(could|can|would|will|do|does|did|is|are|was|were|what|when|where|why|how|who|which|should|shall|may|might|have|has)\b/i;

export interface CleanupOptions {
  removeFillers: boolean;
  /** The original segment, used to mirror its closing punctuation (e.g. "Hi John,"). */
  original?: string;
}

export function minimalCleanup(raw: string, opts: CleanupOptions): string {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return s;

  if (opts.removeFillers) {
    s = s.replace(FILLERS, "$1");
    // Immediate stutter repeats: "I I think" -> "I think", "the the" -> "the".
    // Limited to words that are never legitimately doubled ("that that" and "had had" can be).
    s = s.replace(/\b(i|the|a|an|to|and|we|it|my|so|is|in|of|you|he|she|they|but|for)(\s+\1\b)+/gi, "$1");
    s = s.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/^[,\s]+/, "").replace(/\s+/g, " ").trim();
  }

  // Standalone "i" and its contractions.
  s = s.replace(/\bi\b(?=$|[\s'’,.!?])/g, "I");

  // Space after commas/full stops that recognisers sometimes omit; none before.
  s = s.replace(/\s+([,.!?;:])/g, "$1");

  // Capitalise the first letter and the first letter after sentence-ending punctuation.
  s = s.replace(/^([“"'(]*)([a-z])/, (_, p, c) => p + c.toUpperCase());
  s = s.replace(/([.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());

  // Closing punctuation.
  if (!/[.!?…,:;"”')]$/.test(s)) {
    const origEnd = opts.original?.trim().slice(-1);
    if (origEnd === "," || origEnd === ":") s += origEnd;
    // A name or heading line without punctuation (e.g. a sign-off "Sam") stays that way.
    else if (origEnd && /[\p{L}\p{N}]/u.test(origEnd)) return s;
    else s += QUESTION_STARTERS.test(s) ? "?" : ".";
  }
  return s;
}

/**
 * Join the words of a line said in two goes (the user paused, then carried
 * on). If the second part starts in lower case it continues the sentence, so
 * punctuation that was added to the end of the first part is dropped.
 */
export function joinSpoken(prefix: string, added: string): string {
  const p = prefix.trim();
  const a = added.trim();
  if (!p) return a;
  if (!a) return p;
  if (/^[a-z]/.test(a) && /[.?!]$/.test(p)) return `${p.slice(0, -1)} ${a}`;
  return `${p} ${a}`;
}
