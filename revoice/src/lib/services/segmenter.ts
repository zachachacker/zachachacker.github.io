import type { KeyPoint, Segment } from "../types";
import { api } from "../api/client";
import { buildSegments, groupUnitsHeuristically, isValidGrouping, repairGrouping, splitIntoUnits, validateSegmentation } from "../document/segmentation";

export interface SegmentationResult {
  segments: Segment[];
  source: "ai" | "heuristic";
  /** Why the AI wasn't used, if it wasn't. */
  fallbackReason?: string;
}

export async function segmentDocument(text: string, useAI: boolean, signal?: AbortSignal): Promise<SegmentationResult> {
  const units = splitIntoUnits(text);
  const local = (): SegmentationResult["segments"] => buildSegments(text, units, groupUnitsHeuristically(units));
  if (!units.length) return { segments: [], source: "heuristic" };
  if (!useAI) return { segments: local(), source: "heuristic", fallbackReason: "AI is turned off" };

  const res = await api.segment({ units: units.map((u) => ({ i: u.index, text: u.text, line: u.lineIndex })) }, signal);
  if (!res.ok) return { segments: local(), source: "heuristic", fallbackReason: `AI ${res.reason}` };

  const repaired = repairGrouping(
    units,
    res.data.groups.map((g) => g.units),
    res.data.groups.map((g) => g.keyPoints as KeyPoint[]),
  );
  if (!repaired || !isValidGrouping(units, repaired.groups)) {
    return { segments: local(), source: "heuristic", fallbackReason: "AI grouping was invalid" };
  }
  const segments = buildSegments(text, units, repaired.groups, repaired.keyPoints);
  // Belt and braces: the mapping must be exact or we don't use it.
  if (validateSegmentation(text, segments).length) {
    return { segments: local(), source: "heuristic", fallbackReason: "AI segmentation failed validation" };
  }
  return { segments, source: "ai" };
}
