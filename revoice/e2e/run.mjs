/**
 * End-to-end test of the full Revoice workflow in a real (headless) Chromium.
 *
 * Speech comes from the SIMULATED speech provider (there is no microphone in
 * CI); everything else is real: segmentation, meaning checks and the final
 * review call the actual server, which calls OpenAI when OPENAI_API_KEY is set.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_ENABLE_SIMULATED_SPEECH=1 npm run build && npm start   (port 3000, or set BASE_URL)
 *   node e2e/run.mjs
 */

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
/** OFFLINE=1 runs with AI checking turned off, exercising the local heuristic checker. */
const OFFLINE = process.env.OFFLINE === "1";
const EXEC = process.env.CHROMIUM_PATH ?? (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const OUT = path.resolve("e2e/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = `Hi Dr. Patel,

I hope this message finds you well. I am writing to follow up on our conversation last Tuesday regarding my application for the extended research placement.

I would be grateful if we could arrange a meeting to discuss this further. I am available on Thursday or Friday afternoon, and I can bring the revised budget, which now comes to £2,400 rather than the original £3,100.

My mum supports this request and would be happy to discuss it with you. Please note that I will not be able to start before 14 September, as I am completing a summer course until then.

Thank you for your time and consideration.

Best regards,
Sam`;

/** What the "user" says for each original sentence. `first` is the first attempt; `fix` the follow-up. */
const SCRIPT = [
  { match: "Hi Dr. Patel", first: "hi Doctor Patel" },
  { match: "finds you well", first: "hope you're doing well" },
  { match: "follow up on our conversation", first: "I'm just following up on what we talked about last Tuesday about my application for the extended research placement" },
  { match: "arrange a meeting", first: "could we set up a meeting to talk about it some more" },
  {
    match: "Thursday or Friday",
    first: "I'm free Thursday or Friday afternoon and I can bring the new budget which is now two thousand five hundred pounds instead of three thousand one hundred",
    fix: { action: "redo", say: "I'm free Thursday or Friday afternoon and I can bring the new budget which is now two thousand four hundred pounds instead of three thousand one hundred" },
    expect: "number",
  },
  { match: "My mum supports", first: "my mum agrees with me", fix: { action: "add", say: "and she's happy to talk it through with you" }, expect: "missing" },
  {
    match: "will not be able to start",
    first: "just so you know I can start before the 14th of September because I'm doing a summer course until then",
    fix: { action: "redo", say: "just so you know I can't start before the 14th of September because I'm doing a summer course until then" },
    expect: "negation",
  },
  { match: "Thank you for your time", first: "thanks a lot ... for your time and for considering it", longPause: true },
  { match: "Best regards", special: "speech-error-then-keep-original" },
  { match: /^Sam$/, special: "type" },
];

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 30000, interval = 100, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(interval);
  }
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

// Use the simulated speech provider and skip the first-run notice.
await page.goto(BASE);
await page.evaluate((off) =>
  localStorage.setItem("revoice:v1:settings", JSON.stringify({ speechProvider: "simulated", privacyNoticeSeen: true, speechLanguage: "en-GB", aiEnabled: !off })),
  OFFLINE,
);
await page.reload();

const activeText = () => page.locator('[data-testid="active-segment"] p.lyric').first().innerText().then((t) => t.trim()).catch(() => "");
const activeId = () => page.locator('[data-testid="active-segment"]').getAttribute("data-segment-id").catch(() => null);
const listening = () => page.evaluate(() => !!window.__revoiceSpeech?.isListening?.());
const say = (text, opts = {}) => page.evaluate(([t, o]) => window.__revoiceSpeech.say(t, o), [text, { wordMs: 45, ...opts }]);
const issueVisible = () => page.locator('[data-testid="issue-panel"]').isVisible().catch(() => false);
const readDoc = () =>
  page.evaluate(() => {
    const id = location.pathname.split("/").pop();
    return JSON.parse(localStorage.getItem(`revoice:v1:doc:${id}`));
  });
const segOf = (doc, id) => doc.segments.find((s) => s.id === id);
const textOf = (seg) => seg.revisions.find((r) => r.id === seg.currentRevisionId)?.text ?? null;

function lines(segText) {
  return SCRIPT.filter((s) => (typeof s.match === "string" ? segText.includes(s.match) : s.match.test(segText)));
}

/** Wait until the active segment changes or the issue panel appears. */
async function outcome(prevId, timeout = 30000) {
  return waitFor(
    async () => {
      if (await issueVisible()) return "issue";
      const id = await activeId();
      if (id && id !== prevId) return "advanced";
      if (await page.locator('h2:has-text("Final review")').isVisible().catch(() => false)) return "done";
      return null;
    },
    { timeout, label: "advance or issue" },
  );
}

const t0 = Date.now();
console.log(`Mode: ${OFFLINE ? "OFFLINE (AI off, heuristic checks)" : "AI on"} · ${BASE}`);
try {
  // 1. Paste, start, segment.
  await page.fill("#doc-title", "Placement follow-up");
  await page.fill('[data-testid="doc-text"]', EMAIL);
  await page.click('[data-testid="start-button"]');
  await page.waitForURL(/\/session\//, { timeout: 60000 });
  await page.waitForSelector('[data-testid="active-segment"]');
  let doc = await readDoc();
  const exact = doc.segments.every((s) => doc.original.text.slice(s.start, s.end) === s.originalText);
  const maxWords = Math.max(...doc.segments.map((s) => s.originalText.split(/\s+/).length));
  record(
    "Segmentation: realistic multi-paragraph email",
    exact && doc.segments.length >= 8 && maxWords <= 35,
    `${doc.segments.length} segments via ${doc.segmentation.source}, longest ${maxWords} words, exact source spans: ${exact}`,
  );
  await page.screenshot({ path: `${OUT}/01-session-start.png` });

  // Arm the mic (Space).
  await page.keyboard.press("Space");
  await waitFor(listening, { label: "mic listening" });

  let refreshed = false;
  let networkTested = false;
  let restartTested = false;
  let guard = 0;

  while (guard++ < 40) {
    if (await page.locator('h2:has-text("Final review")').isVisible().catch(() => false)) break;
    const id = await activeId();
    const text = await activeText();
    const parts = lines(text);
    if (!parts.length) throw new Error(`No script for segment: ${text}`);

    // --- Special: speech recognition error, then keep the original wording.
    if (parts[0].special === "speech-error-then-keep-original") {
      await waitFor(listening, { label: "listening before error" });
      await page.evaluate(() => window.__revoiceSpeech.fail("network"));
      const toast = await page.locator('[role="alert"]:has-text("Simulated network error")').isVisible({ timeout: 3000 }).catch(() => false);
      const micOff = (await page.getAttribute('[data-testid="mic-button"]', "aria-pressed")) === "false";
      record("Speech recognition error is surfaced and recoverable", toast && micOff, `error shown: ${toast}, mic stopped: ${micOff}`);
      await page.keyboard.press("o"); // use original wording for the sign-off
      const o = await outcome(id);
      record("Keep original wording for a sign-off", o === "advanced", o);
      continue;
    }

    // --- Special: type instead of speaking (manual correction path).
    if (parts[0].special === "type") {
      await page.keyboard.press("e");
      await page.waitForSelector('[data-testid="edit-textarea"]');
      await page.fill('[data-testid="edit-textarea"]', "Sam");
      await page.keyboard.press("Control+Enter");
      const o = await outcome(id);
      doc = await readDoc();
      record("Typed version (no microphone) completes a segment", o === "done" || o === "advanced", `outcome: ${o}`);
      break;
    }

    await waitFor(listening, { label: `listening on "${text.slice(0, 30)}"` });

    // --- Restart the current segment mid-utterance.
    if (!restartTested && text.includes("finds you well")) {
      restartTested = true;
      await say("uh no wait that came out completely wrong");
      await page.keyboard.press("r");
      await waitFor(listening, { label: "listening after redo" });
      const cleared = (await page.locator('[data-testid="live-transcript"]').count()) === 0;
      await say(parts.map((p) => p.first).join(" "));
      const o = await outcome(id);
      doc = await readDoc();
      const saved = textOf(segOf(doc, id)) ?? "";
      record(
        "Restart a segment mid-speech discards the abandoned words",
        o !== "issue" && cleared && !/wrong/i.test(saved) && segOf(doc, id).revisions.length === 1,
        `saved: "${saved}"`,
      );
      if (o === "issue") await page.click('button:has-text("Keep my version")');
      continue;
    }

    // --- Network interruption during the meaning check.
    const cutNetwork = !OFFLINE && !networkTested && text.includes("arrange a meeting") && !text.includes("Thursday");
    if (cutNetwork) {
      networkTested = true;
      await page.route("**/api/check", (r) => r.abort("internetdisconnected"));
    }

    const spoken = parts.map((p) => p.first).join(" ");
    const sayStart = Date.now();
    await say(spoken, parts.some((p) => p.longPause) ? { pauseMs: 1300 } : {});
    let o = await outcome(id);

    if (cutNetwork) {
      doc = await readDoc();
      const seg = segOf(doc, id);
      const notice = await page.locator('[role="alert"]', { hasText: /Couldn.t reach the AI/ }).isVisible().catch(() => false);
      record(
        "Network failure during check: falls back offline, work saved, flow continues",
        o === "advanced" && seg.check?.source === "heuristic" && seg.check?.needsRecheck === true && notice,
        `outcome ${o}, check source ${seg.check?.source}, notice ${notice}`,
      );
      await page.unroute("**/api/check");
      networkTested = id; // remember which segment needs a recheck
    }

    if (parts.some((p) => p.longPause)) {
      doc = await readDoc();
      const seg = segOf(doc, id);
      const saved = textOf(seg) ?? "";
      record(
        "Long mid-sentence pause (1.3 s) does not split the utterance",
        seg.revisions.length === 1 && /thanks a lot/i.test(saved) && /considering/i.test(saved),
        `"${saved}" (took ${Date.now() - sayStart} ms)`,
      );
    }

    // The offline checker only compares numbers, names, dates and negatives, so it can't see a paraphrased omission.
    const expectIssue = parts.find((p) => p.expect && !(OFFLINE && p.expect === "missing"));
    if (expectIssue) {
      const issueText = o === "issue" ? await page.locator('[data-testid="issue-panel"]').innerText() : "";
      const label = { number: "Changing a number", missing: "Omitting an important detail", negation: "Reversing a negation" }[expectIssue.expect];
      record(`${label} is caught`, o === "issue", issueText.replace(/\s+/g, " ").slice(0, 220));
      await page.screenshot({ path: `${OUT}/issue-${expectIssue.expect}.png` });
      if (o === "issue") {
        const fix = expectIssue.fix;
        await page.click(fix.action === "add" ? 'button:has-text("Add it in my own words")' : 'button:has-text("Say it again")');
        await waitFor(listening, { label: "listening for fix" });
        await say(fix.say);
        o = await outcome(id);
        doc = await readDoc();
        const saved = textOf(segOf(doc, id)) ?? "";
        record(`${label}: fixed in the user's own words`, o === "advanced" || o === "done", `"${saved}"`);
        if (o === "issue") await page.click('button:has-text("Keep my version")');
      }
    } else if (o === "issue") {
      const issueText = await page.locator('[data-testid="issue-panel"]').innerText();
      record(`Faithful rephrasing accepted: "${text.slice(0, 40)}…"`, false, `unexpected issue: ${issueText.replace(/\s+/g, " ").slice(0, 200)}`);
      await page.click('button:has-text("Keep my version")');
    } else {
      record(`Faithful rephrasing accepted & auto-advanced: "${text.slice(0, 40)}…"`, true);
    }

    // --- Refresh halfway through.
    if (!refreshed && text.includes("My mum supports")) {
      refreshed = true;
      const before = await readDoc();
      const progressBefore = await page.locator('[data-testid="progress"]').innerText();
      await page.reload();
      await page.waitForSelector('[data-testid="active-segment"]');
      const after = await readDoc();
      const progressAfter = await page.locator('[data-testid="progress"]').innerText();
      record(
        "Refresh halfway: progress, transcripts and position restored",
        JSON.stringify(before.segments) === JSON.stringify(after.segments) && before.activeSegmentId === after.activeSegmentId && progressBefore === progressAfter,
        `progress ${progressAfter}`,
      );
      await page.keyboard.press("Space");
    }
  }

  // Background re-check of the segment checked offline.
  if (typeof networkTested === "string") {
    const rechecked = await waitFor(
      async () => {
        const d = await readDoc();
        const s = segOf(d, networkTested);
        return s.check?.source === "ai" && !s.check?.needsRecheck ? s : null;
      },
      { timeout: 30000, label: "AI recheck" },
    ).catch(() => null);
    record("Offline-checked segment is re-checked by AI once the network is back", !!rechecked, rechecked ? `verdict ${rechecked.check.verdict}` : "not rechecked");
  }

  // Final review appears automatically.
  await page.waitForSelector('h2:has-text("Final review")', { timeout: 15000 });
  await waitFor(() => page.locator('[data-testid="finding"], [data-testid="review-clean"]').first().isVisible().catch(() => false), {
    timeout: 90000,
    label: "review result",
  });
  doc = await readDoc();
  record(
    "Whole-document consistency review runs after completion",
    !!doc.review && doc.review.source === (OFFLINE ? "heuristic" : "ai"),
    `${doc.review.source} review, ${doc.review.findings.length} finding(s): ${doc.review.findings.map((f) => `[${f.category}/${f.kind}] ${f.explanation}`).join(" | ").slice(0, 400)}`,
  );
  await page.screenshot({ path: `${OUT}/02-review.png`, fullPage: true });

  // Edit an earlier segment: open the first one from Preview and re-say it.
  await page.click('nav[aria-label="View"] button:has-text("Preview")');
  await page.locator('[data-testid="preview-rewritten"] [role="button"]').first().click();
  await page.waitForSelector('[data-testid="active-segment"]');
  const firstId = await activeId();
  await page.keyboard.press("Space");
  await waitFor(listening, { label: "listening on first segment" });
  await say("hello Doctor Patel");
  await outcome(firstId);
  await sleep(500);
  doc = await readDoc();
  const first = segOf(doc, firstId);
  record(
    "Editing an earlier segment replaces it (no duplicate) and keeps history",
    textOf(first) === "Hello Doctor Patel," && first.revisions.length === 2,
    `now "${textOf(first)}", ${first.revisions.length} revisions`,
  );

  // Export.
  await page.click('nav[aria-label="View"] button:has-text("Export")');
  const finalText = await page.inputValue('[data-testid="final-text"]');
  await page.click('[data-testid="copy-button"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  record("Copy to clipboard", clip === finalText, `${clip.length} chars`);
  const [txt] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text(".txt")')]);
  const [md] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text(".md")')]);
  const txtBody = fs.readFileSync(await txt.path(), "utf8");
  const mdBody = fs.readFileSync(await md.path(), "utf8");
  record("Download .txt and .md", txtBody.trim() === finalText.trim() && mdBody.startsWith("# Placement follow-up"), `${txt.suggestedFilename()}, ${md.suggestedFilename()}`);

  const paragraphsOk = finalText.split("\n\n").length === EMAIL.split("\n\n").length;
  const keeps = ["Patel", "Tuesday", "extended research placement", "Thursday", "Friday", "two thousand four hundred", "three thousand one hundred", ...(OFFLINE ? [] : ["happy to talk it through"]), "can't start", "14th of September", "summer course", "Best regards,\nSam"];
  const missing = keeps.filter((k) => !finalText.includes(k));
  const ownWords = ["hope you're doing well", "I'm just following up", "could we set up a meeting", "thanks a lot"].every((w) => finalText.toLowerCase().includes(w.toLowerCase()));
  record(
    "Final text keeps the original's meaning in the user's own words",
    paragraphsOk && !missing.length && ownWords,
    `paragraphs ok: ${paragraphsOk}, missing: [${missing.join(", ")}], own wording kept: ${ownWords}`,
  );
  console.log("\n----- FINAL TEXT -----\n" + finalText + "\n----------------------");
  await page.screenshot({ path: `${OUT}/03-export.png` });

  // Home lists the document as finished; reopening works.
  await page.goto(BASE);
  const rows = await page.locator('[data-testid="doc-row"]').count();
  record("Saved session listed on the home page", rows >= 1, `${rows} row(s)`);
  await page.screenshot({ path: `${OUT}/04-home.png` });
} catch (e) {
  record("Unexpected failure", false, e.message);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => undefined);
} finally {
  const relevantErrors = consoleErrors.filter((e) => !/Failed to load resource|internetdisconnected|ERR_INTERNET_DISCONNECTED/.test(e));
  record("No unexpected console errors", relevantErrors.length === 0, relevantErrors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(failed.length ? 1 : 0);
}
