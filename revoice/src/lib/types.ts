/**
 * Core data model for Revoice.
 *
 * The original document is immutable once a session starts. Every segment
 * points back at an exact character span of that original, and every change
 * the user makes to a segment is appended to its revision history.
 */

export type ISODate = string;

/** A piece of information inside a segment that a rewrite must keep. */
export type KeyPointKind =
  | "fact"
  | "request"
  | "commitment"
  | "qualification"
  | "name"
  | "date"
  | "number"
  | "condition"
  | "negation"
  | "intent";

export interface KeyPoint {
  kind: KeyPointKind;
  /** Short plain-language description, e.g. "Mum is happy to discuss it". */
  text: string;
}

export type SegmentStatus =
  /** Not attempted yet. */
  | "pending"
  /** Accepted: either the check passed or the user chose to keep their version. */
  | "completed"
  /** Has a rewrite, but an important meaning issue is unresolved. */
  | "flagged"
  /** User skipped it; reconstruction falls back to the original text. */
  | "skipped";

export type RevisionSource =
  | "speech"
  | "speech-append"
  | "typed"
  | "edit"
  | "kept-original"
  | "review-fix"
  | "cleanup-suggestion"
  | "merge"
  | "undo";

export interface Revision {
  id: string;
  /** Text after Revoice's permitted automatic cleanup. */
  text: string;
  /** Exactly what the speech recogniser produced, before cleanup. */
  rawTranscript?: string;
  source: RevisionSource;
  createdAt: ISODate;
}

export type IssueKind =
  | "missing_detail"
  | "number_changed"
  | "negation_reversed"
  | "name_changed"
  | "date_changed"
  | "request_changed"
  | "commitment_changed"
  | "condition_changed"
  | "qualification_changed"
  | "added_claim"
  | "other";

export type IssueResolution = "kept" | "dismissed";

export interface MeaningIssue {
  id: string;
  kind: IssueKind;
  /** "important" pauses progression; "minor" is shown but never blocks. */
  severity: "important" | "minor";
  /** The original detail at stake, phrased plainly ("Your mum is also happy to discuss this."). */
  detail: string;
  /** One calm sentence explaining the difference. */
  explanation: string;
  resolution?: IssueResolution;
}

export type MeaningVerdict = "preserved" | "minor_difference" | "missing_detail" | "meaning_changed";

/** A suggested wording change; never applied without the user's approval. */
export interface CleanupSuggestion {
  id: string;
  from: string;
  to: string;
  reason: string;
}

export interface MeaningCheck {
  verdict: MeaningVerdict;
  issues: MeaningIssue[];
  /** "ai" = OpenAI model; "heuristic" = local rule-based checker (offline / no key). */
  source: "ai" | "heuristic";
  /** The rewrite text that was checked; a check is stale if the text has changed. */
  checkedText: string;
  checkedAt: ISODate;
  /** True when an AI check was wanted but unavailable; re-run when back online. */
  needsRecheck?: boolean;
  suggestions?: CleanupSuggestion[];
}

export interface Segment {
  id: string;
  /** Exact source span: original.text.slice(start, end) === originalText. */
  start: number;
  end: number;
  originalText: string;
  paragraphIndex: number;
  keyPoints: KeyPoint[];
  status: SegmentStatus;
  revisions: Revision[];
  /** Points into revisions; null when nothing has been recorded. */
  currentRevisionId: string | null;
  check: MeaningCheck | null;
  updatedAt: ISODate;
}

export interface OriginalDocument {
  /** Never modified after creation. */
  text: string;
  importedAt: ISODate;
  /** Room for future importers (docx, email, url...). */
  format: "plain-text";
}

export type ReviewFindingKind =
  | "missing_information"
  | "repetition"
  | "contradiction"
  | "broken_transition"
  | "unclear_reference"
  | "meaning_change"
  | "commitment_change"
  | "optional_improvement";

export interface ProposedFix {
  segmentId: string;
  /** Exact substring of the segment's current rewrite to replace. Empty string = append. */
  from: string;
  to: string;
}

export interface ReviewFinding {
  id: string;
  kind: ReviewFindingKind;
  /** "meaning" = substantive difference from the original; "optional" = writing improvement. */
  category: "meaning" | "optional";
  segmentIds: string[];
  explanation: string;
  fix?: ProposedFix;
  status: "open" | "applied" | "dismissed";
}

export interface ConsistencyReview {
  source: "ai" | "heuristic";
  createdAt: ISODate;
  /** Hash of the reconstructed text the review ran against. */
  basedOn: string;
  findings: ReviewFinding[];
}

export interface RevoiceDocument {
  id: string;
  /** Storage schema version, for future migrations. */
  version: 1;
  title: string;
  original: OriginalDocument;
  segmentation: { source: "ai" | "heuristic"; createdAt: ISODate };
  segments: Segment[];
  activeSegmentId: string | null;
  /** User's free edits to the whole document after the voice session; null = assembled from segments. */
  finalEdit: { text: string; editedAt: ISODate } | null;
  review: ConsistencyReview | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  completedAt: ISODate | null;
}

export interface Settings {
  autoProgress: boolean;
  /** Pause after acceptance before gliding to the next segment. */
  transitionDelayMs: number;
  /** Base silence needed to treat an utterance as finished. */
  silenceMs: number;
  /** Learn the user's natural pause length and lengthen the threshold to fit. */
  adaptiveSilence: boolean;
  cleanup: "minimal" | "suggest";
  removeFillers: boolean;
  /** Send text to OpenAI for segmentation and checks. Off = local heuristics only. */
  aiEnabled: boolean;
  speechProvider: "webspeech" | "openai" | "simulated";
  speechLanguage: string;
  fontScale: number;
  highContrast: boolean;
  reducedMotion: "system" | "on" | "off";
  privacyNoticeSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoProgress: true,
  transitionDelayMs: 700,
  silenceMs: 1700,
  adaptiveSilence: true,
  cleanup: "minimal",
  removeFillers: true,
  aiEnabled: true,
  speechProvider: "webspeech",
  speechLanguage: "en-GB",
  fontScale: 1,
  highContrast: false,
  reducedMotion: "system",
  privacyNoticeSeen: false,
};

/** Summary row for the landing page, so the list doesn't load every document. */
export interface DocumentSummary {
  id: string;
  title: string;
  segmentCount: number;
  doneCount: number;
  completedAt: ISODate | null;
  updatedAt: ISODate;
}
