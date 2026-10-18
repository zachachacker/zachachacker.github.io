import { describe, expect, it } from "vitest";
import { SAMPLE_EMAIL } from "@/test/fixtures";
import { segmentHeuristically } from "./segmentation";
import {
  addRevision, applyCheck, createDocument, currentText, keepMyVersion, keepOriginal, progress,
  redoRevision, skipSegment, undoRevision, nextOpenSegment,
} from "./operations";
import { assembleRewritten, finalText, toMarkdown } from "./reconstruct";
import { heuristicCheck } from "../meaning/heuristics";
import { KeyValueDocumentStore, MemoryKeyValue } from "../storage/store";

function newDoc() {
  return createDocument("Placement email", SAMPLE_EMAIL, segmentHeuristically(SAMPLE_EMAIL), "heuristic");
}

function speak(doc: ReturnType<typeof newDoc>, i: number, text: string) {
  const id = doc.segments[i].id;
  doc = addRevision(doc, id, { text, rawTranscript: text, source: "speech" });
  return applyCheck(doc, id, heuristicCheck(doc.segments[i].originalText, text));
}

describe("document operations", () => {
  it("never modifies the original", () => {
    let doc = newDoc();
    doc = speak(doc, 0, "Hey Dr. Patel,");
    expect(doc.original.text).toBe(SAMPLE_EMAIL);
  });

  it("re-recording replaces the current version without duplicating it", () => {
    let doc = newDoc();
    doc = speak(doc, 1, "Hope you're well.");
    doc = speak(doc, 1, "Hope you're doing well.");
    const seg = doc.segments[1];
    expect(currentText(seg)).toBe("Hope you're doing well.");
    expect(seg.revisions).toHaveLength(2);
    expect(assembleRewritten(doc).match(/Hope you're/g)).toHaveLength(1);
  });

  it("undo and redo walk the revision history", () => {
    let doc = newDoc();
    doc = speak(doc, 1, "First try.");
    doc = speak(doc, 1, "Second try.");
    const id = doc.segments[1].id;
    doc = undoRevision(doc, id);
    expect(currentText(doc.segments[1])).toBe("First try.");
    doc = redoRevision(doc, id);
    expect(currentText(doc.segments[1])).toBe("Second try.");
    doc = undoRevision(undoRevision(doc, id), id);
    expect(currentText(doc.segments[1])).toBeNull();
    expect(doc.segments[1].status).toBe("pending");
  });

  it("flags important issues and completes once the user keeps their version", () => {
    let doc = newDoc();
    const i = doc.segments.findIndex((s) => s.originalText.includes("will not be able"));
    doc = speak(doc, i, "I'll be able to start before the 14th of September.");
    expect(doc.segments[i].status).toBe("flagged");
    doc = keepMyVersion(doc, doc.segments[i].id);
    expect(doc.segments[i].status).toBe("completed");
  });

  it("tracks progress, skipping and completion", () => {
    let doc = newDoc();
    for (let i = 0; i < doc.segments.length; i++) doc = keepOriginal(doc, doc.segments[i].id);
    expect(progress(doc).percent).toBe(100);
    expect(doc.completedAt).not.toBeNull();
    doc = undoRevision(doc, doc.segments[0].id);
    expect(doc.completedAt).toBeNull();
    doc = skipSegment(doc, doc.segments[0].id);
    expect(doc.segments[0].status).toBe("skipped");
    expect(nextOpenSegment(doc, null)).toBeNull();
  });
});

describe("reconstruction", () => {
  it("rebuilds the exact original when nothing is rewritten", () => {
    expect(assembleRewritten(newDoc())).toBe(SAMPLE_EMAIL);
  });

  it("keeps paragraph and line structure with rewritten text", () => {
    let doc = newDoc();
    doc = speak(doc, 0, "Hey Dr. Patel,");
    const out = assembleRewritten(doc);
    expect(out.startsWith("Hey Dr. Patel,\n\n")).toBe(true);
    expect(out.endsWith("Best regards,\nSam")).toBe(true);
    expect(out.split("\n\n")).toHaveLength(SAMPLE_EMAIL.split("\n\n").length);
  });

  it("uses the whole-document edit when present", () => {
    const doc = { ...newDoc(), finalEdit: { text: "Edited.", editedAt: new Date().toISOString() } };
    expect(finalText(doc)).toBe("Edited.");
  });

  it("exports markdown with hard line breaks inside paragraphs", () => {
    const md = toMarkdown("T", "Best regards,\nSam");
    expect(md).toBe("# T\n\nBest regards,  \nSam\n");
  });
});

describe("storage", () => {
  it("round-trips documents and survives a 'refresh' (new store on the same data)", async () => {
    const kv = new MemoryKeyValue();
    let doc = newDoc();
    doc = speak(doc, 0, "Hey Dr. Patel,");
    await new KeyValueDocumentStore(kv).save(doc);
    const reopened = new KeyValueDocumentStore(kv);
    const loaded = await reopened.get(doc.id);
    expect(loaded).toEqual(doc);
    expect((await reopened.list())[0]).toMatchObject({ id: doc.id, doneCount: 1 });
  });

  it("rebuilds a corrupted index and deletes documents", async () => {
    const kv = new MemoryKeyValue();
    const store = new KeyValueDocumentStore(kv);
    const doc = newDoc();
    await store.save(doc);
    kv.setItem("revoice:v1:index", "{not json");
    expect((await store.list()).map((d) => d.id)).toEqual([doc.id]);
    await store.delete(doc.id);
    expect(await store.get(doc.id)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("reports quota errors instead of failing silently", async () => {
    const kv = new MemoryKeyValue();
    kv.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    await expect(new KeyValueDocumentStore(kv).save(newDoc())).rejects.toThrow(/refused to save/);
  });
});
