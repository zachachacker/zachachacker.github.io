"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RevoiceDocument } from "@/lib/types";
import { getStore } from "@/lib/storage/store";

/**
 * Loads a document and saves every change immediately. Saving is local, so it
 * can't be lost to a network failure; if the browser refuses (storage full),
 * the error is surfaced and the in-memory copy is kept.
 */
export function useDocument(id: string) {
  const [doc, setDoc] = useState<RevoiceDocument | null>(null);
  const [loadError, setLoadError] = useState<"not-found" | "unreadable" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const docRef = useRef<RevoiceDocument | null>(null);

  useEffect(() => {
    let alive = true;
    getStore()
      .get(id)
      .then((d) => {
        if (!alive) return;
        if (!d) setLoadError("not-found");
        docRef.current = d;
        setDoc(d);
      })
      .catch(() => alive && setLoadError("unreadable"));
    return () => {
      alive = false;
    };
  }, [id]);

  const persist = useCallback((d: RevoiceDocument) => {
    getStore()
      .save(d)
      .then(() => setSaveError(null))
      .catch((e: Error) => setSaveError(e.message));
  }, []);

  const update = useCallback(
    (fn: (d: RevoiceDocument) => RevoiceDocument) => {
      const prev = docRef.current;
      if (!prev) return;
      const next = fn(prev);
      if (next === prev) return;
      docRef.current = next;
      setDoc(next);
      persist(next);
    },
    [persist],
  );

  // Belt and braces: write the latest state when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => docRef.current && persist(docRef.current);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [persist]);

  const get = useCallback(() => docRef.current, []);

  return { doc, get, update, loadError, saveError };
}
