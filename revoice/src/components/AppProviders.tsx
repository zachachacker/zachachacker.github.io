"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { getStore } from "@/lib/storage/store";
import { api } from "@/lib/api/client";
import type { StatusResponse } from "@/lib/api/contracts";

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  update(patch: Partial<Settings>): void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: () => undefined,
});

export function useSettings() {
  return useContext(SettingsContext);
}

interface ServerStatus {
  /** null while unknown. */
  status: StatusResponse | null;
  reachable: boolean;
  refresh(): void;
}

const StatusContext = createContext<ServerStatus>({ status: null, reachable: true, refresh: () => undefined });

export function useServerStatus() {
  return useContext(StatusContext);
}

function useSystemReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const fn = () => setReduce(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduce;
}

export function useReducedMotion(): boolean {
  const { settings } = useSettings();
  const system = useSystemReducedMotion();
  return settings.reducedMotion === "on" || (settings.reducedMotion === "system" && system);
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [reachable, setReachable] = useState(true);
  const systemReduce = useSystemReducedMotion();

  useEffect(() => {
    void getStore().getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const refresh = useCallback(() => {
    void api.status().then((r) => {
      setReachable(r.ok);
      if (r.ok) setStatus(r.data);
    });
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [refresh]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void getStore().saveSettings(next).catch(() => undefined);
      return next;
    });
  }, []);

  const reduce = settings.reducedMotion === "on" || (settings.reducedMotion === "system" && systemReduce);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-scale", String(settings.fontScale));
    if (settings.highContrast) root.dataset.contrast = "high";
    else delete root.dataset.contrast;
    root.dataset.motion = reduce ? "reduce" : settings.reducedMotion === "off" ? "allow" : "system";
  }, [settings.fontScale, settings.highContrast, settings.reducedMotion, reduce]);

  const settingsValue = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);
  const statusValue = useMemo(() => ({ status, reachable, refresh }), [status, reachable, refresh]);

  return (
    <SettingsContext.Provider value={settingsValue}>
      <StatusContext.Provider value={statusValue}>
        <MotionConfig reducedMotion={reduce ? "always" : "never"}>{children}</MotionConfig>
      </StatusContext.Provider>
    </SettingsContext.Provider>
  );
}

/** True when AI calls should be attempted. */
export function useAIActive(): boolean {
  const { settings } = useSettings();
  const { status } = useServerStatus();
  return settings.aiEnabled && status?.ai !== false;
}
