/**
 * Storage abstraction. The MVP persists to localStorage on the user's device;
 * a backend implementation only needs to satisfy `DocumentStore`.
 */

import type { DocumentSummary, RevoiceDocument, Settings } from "../types";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../types";

export interface DocumentStore {
  list(): Promise<DocumentSummary[]>;
  get(id: string): Promise<RevoiceDocument | null>;
  save(doc: RevoiceDocument): Promise<void>;
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageError";
  }
}

export function summarize(doc: RevoiceDocument): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    segmentCount: doc.segments.length,
    doneCount: doc.segments.filter((s) => s.status === "completed" || s.status === "skipped").length,
    completedAt: doc.completedAt,
    updatedAt: doc.updatedAt,
  };
}

/** Minimal key-value interface so the store can be tested without a browser. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

const PREFIX = "revoice:v1:";
const DOC = (id: string) => `${PREFIX}doc:${id}`;
const INDEX = `${PREFIX}index`;
const SETTINGS = `${PREFIX}settings`;

export class KeyValueDocumentStore implements DocumentStore {
  constructor(private readonly kv: KeyValue) {}

  private readIndex(): DocumentSummary[] {
    try {
      const raw = this.kv.getItem(INDEX);
      const parsed = raw ? (JSON.parse(raw) as DocumentSummary[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return this.rebuildIndex();
    }
  }

  /** Recover the index from the documents themselves if it is ever corrupted. */
  private rebuildIndex(): DocumentSummary[] {
    const out: DocumentSummary[] = [];
    for (let i = 0; i < this.kv.length; i++) {
      const k = this.kv.key(i);
      if (!k?.startsWith(`${PREFIX}doc:`)) continue;
      try {
        out.push(summarize(JSON.parse(this.kv.getItem(k)!) as RevoiceDocument));
      } catch {
        /* skip unreadable */
      }
    }
    return out;
  }

  private write(key: string, value: string) {
    try {
      this.kv.setItem(key, value);
    } catch (e) {
      throw new StorageError("Your browser refused to save (storage may be full).", e);
    }
  }

  async list(): Promise<DocumentSummary[]> {
    return this.readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<RevoiceDocument | null> {
    const raw = this.kv.getItem(DOC(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RevoiceDocument;
    } catch (e) {
      throw new StorageError("This saved document could not be read.", e);
    }
  }

  async save(doc: RevoiceDocument): Promise<void> {
    // Document first, then index: a crash in between leaves a recoverable state.
    this.write(DOC(doc.id), JSON.stringify(doc));
    const index = this.readIndex().filter((d) => d.id !== doc.id);
    index.push(summarize(doc));
    this.write(INDEX, JSON.stringify(index));
  }

  async delete(id: string): Promise<void> {
    this.kv.removeItem(DOC(id));
    this.write(INDEX, JSON.stringify(this.readIndex().filter((d) => d.id !== id)));
  }

  async deleteAll(): Promise<void> {
    const keys: string[] = [];
    for (let i = 0; i < this.kv.length; i++) {
      const k = this.kv.key(i);
      if (k?.startsWith(`${PREFIX}doc:`)) keys.push(k);
    }
    keys.forEach((k) => this.kv.removeItem(k));
    this.kv.removeItem(INDEX);
  }

  async getSettings(): Promise<Settings> {
    try {
      const raw = this.kv.getItem(SETTINGS);
      return raw ? migrateSettings(JSON.parse(raw) as Partial<Settings>) : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.write(SETTINGS, JSON.stringify(settings));
  }
}

/** In-memory fallback (private browsing modes that block localStorage, tests). */
export class MemoryKeyValue implements KeyValue {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

/**
 * Version 1 saved the old timing defaults (1.7 s silence, 0.7 s before moving
 * on), which proved too short for people composing their own wording. Values
 * the user never changed move to the new defaults; deliberate choices stay.
 */
export function migrateSettings(saved: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...saved };
  if ((saved.settingsVersion ?? 1) < 2) {
    if (saved.silenceMs === 1700) s.silenceMs = DEFAULT_SETTINGS.silenceMs;
    if (saved.transitionDelayMs === 700) s.transitionDelayMs = DEFAULT_SETTINGS.transitionDelayMs;
  }
  s.settingsVersion = SETTINGS_VERSION;
  return s;
}

let singleton: DocumentStore | null = null;

export function getStore(): DocumentStore {
  if (singleton) return singleton;
  let kv: KeyValue;
  try {
    kv = window.localStorage;
    kv.setItem(`${PREFIX}probe`, "1");
    kv.removeItem(`${PREFIX}probe`);
  } catch {
    kv = new MemoryKeyValue();
  }
  singleton = new KeyValueDocumentStore(kv);
  return singleton;
}
