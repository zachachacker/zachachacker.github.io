/** Request/response shapes shared by the API routes and the browser client. */

import { z } from "zod";

const MAX_TEXT = 40_000;

export const KEY_POINT_KINDS = [
  "fact", "request", "commitment", "qualification", "name", "date", "number", "condition", "negation", "intent",
] as const;

export const ISSUE_KINDS = [
  "missing_detail", "number_changed", "negation_reversed", "name_changed", "date_changed", "request_changed",
  "commitment_changed", "condition_changed", "qualification_changed", "added_claim", "other",
] as const;

export const FINDING_KINDS = [
  "missing_information", "repetition", "contradiction", "broken_transition", "unclear_reference",
  "meaning_change", "commitment_change", "optional_improvement",
] as const;

export const SegmentRequest = z.object({
  units: z
    .array(z.object({ i: z.number().int().min(0), text: z.string().max(4000), line: z.number().int().min(0) }))
    .min(1)
    .max(600),
});
export type SegmentRequest = z.infer<typeof SegmentRequest>;

export interface SegmentResponse {
  groups: Array<{ units: number[]; keyPoints: Array<{ kind: (typeof KEY_POINT_KINDS)[number]; text: string }> }>;
}

export const CheckRequest = z.object({
  original: z.string().min(1).max(4000),
  previousOriginal: z.string().max(4000).optional(),
  previousRewrite: z.string().max(4000).optional(),
  nextOriginal: z.string().max(4000).optional(),
  keyPoints: z.array(z.object({ kind: z.string(), text: z.string().max(300) })).max(30).default([]),
  rewrite: z.string().min(1).max(6000),
  cleanup: z.enum(["minimal", "suggest"]).default("minimal"),
});
export type CheckRequest = z.infer<typeof CheckRequest>;

export interface CheckResponse {
  verdict: "preserved" | "minor_difference" | "missing_detail" | "meaning_changed";
  issues: Array<{
    kind: (typeof ISSUE_KINDS)[number];
    severity: "important" | "minor";
    detail: string;
    explanation: string;
  }>;
  suggestions: Array<{ from: string; to: string; reason: string }>;
}

export const ReviewRequest = z.object({
  title: z.string().max(300),
  original: z.string().min(1).max(MAX_TEXT),
  segments: z
    .array(
      z.object({
        id: z.string().max(100),
        original: z.string().max(4000),
        rewrite: z.string().max(6000),
        status: z.enum(["pending", "completed", "flagged", "skipped"]),
      }),
    )
    .min(1)
    .max(600),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export interface ReviewResponse {
  findings: Array<{
    kind: (typeof FINDING_KINDS)[number];
    category: "meaning" | "optional";
    segmentIds: string[];
    explanation: string;
    fix: { segmentId: string; from: string; to: string } | null;
  }>;
}

export interface StatusResponse {
  ai: boolean;
  transcription: boolean;
  model: string | null;
}

export const LIMITS = { MAX_TEXT, MAX_AUDIO_BYTES: 15 * 1024 * 1024 };
