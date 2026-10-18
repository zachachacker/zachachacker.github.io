/**
 * Browser-side API calls. Every call has a timeout and resolves to a result
 * object instead of throwing, so a failed request can never lose work: the
 * caller falls back to a local implementation and keeps going.
 */

import type { CheckRequest, CheckResponse, ReviewRequest, ReviewResponse, SegmentRequest, SegmentResponse, StatusResponse } from "./contracts";

export type ApiFailure = "offline" | "timeout" | "unavailable" | "error";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: ApiFailure };

async function request<T>(path: string, init: RequestInit, timeoutMs: number, external?: AbortSignal): Promise<ApiResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, reason: "offline" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  const onAbort = () => ctrl.abort("cancelled");
  external?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (res.status === 503) return { ok: false, reason: "unavailable" };
    if (!res.ok) return { ok: false, reason: "error" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    if (ctrl.signal.aborted && ctrl.signal.reason === "timeout") return { ok: false, reason: "timeout" };
    return { ok: false, reason: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error" };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  status: () => request<StatusResponse>("/api/status", { method: "GET" }, 5_000),
  segment: (body: SegmentRequest, signal?: AbortSignal) => request<SegmentResponse>("/api/segment", json(body), 45_000, signal),
  check: (body: CheckRequest, signal?: AbortSignal) => request<CheckResponse>("/api/check", json(body), 20_000, signal),
  review: (body: ReviewRequest, signal?: AbortSignal) => request<ReviewResponse>("/api/review", json(body), 60_000, signal),
  transcribe: (form: FormData, signal?: AbortSignal) => request<{ text: string }>("/api/transcribe", { method: "POST", body: form }, 30_000, signal),
};
