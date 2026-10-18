/**
 * Regression tests for how the flow behaves around pauses — the situations
 * where a person composing their own wording stops to think.
 *
 *   BASE_URL=http://localhost:3000 node e2e/flow-regressions.mjs
 * (needs a build with NEXT_PUBLIC_ENABLE_SIMULATED_SPEECH=1)
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EXEC = process.env.CHROMIUM_PATH ?? (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);

const TEXT = `I would be grateful if we could arrange a meeting to discuss this further.

My mum supports this request and would be happy to discuss it with you.

Thank you for your time and consideration.`;

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXEC });

async function session() {
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE);
  await page.evaluate(() => localStorage.setItem("revoice:v1:settings", JSON.stringify({ speechProvider: "simulated", privacyNoticeSeen: true })));
  await page.goto(BASE);
  await page.fill('[data-testid="doc-text"]', TEXT);
  await page.click('[data-testid="start-button"]');
  await page.waitForSelector('[data-testid="active-segment"]');
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__revoiceSpeech?.isListening());
  return page;
}

const say = (page, text) => page.evaluate((t) => window.__revoiceSpeech.say(t, { wordMs: 60 }), text);
const listening = (page) => page.evaluate(() => !!window.__revoiceSpeech?.isListening?.());
const activeText = (page) => page.locator('[data-testid="active-segment"] p.lyric').first().innerText();
const readDoc = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes(":doc:")))));
const textOf = (s) => s.revisions.find((r) => r.id === s.currentRevisionId)?.text ?? null;

/** A thinking pause of `gapMs` in the middle of a sentence must not move to the next line or lose words. */
async function pauseCase(gapMs) {
  const page = await session();
  const first = await activeText(page);
  await say(page, "could we set up a meeting");
  await sleep(gapMs);
  const heardAfterPause = await listening(page);
  await say(page, "to talk about it some more");
  // Let it finish, check and move on.
  await page.waitForFunction((t) => document.querySelector('[data-testid="active-segment"] p.lyric')?.innerText.trim() !== t, first.trim(), { timeout: 20000 }).catch(() => undefined);
  await sleep(500);
  const doc = await readDoc(page);
  const [s1, s2] = doc.segments;
  record(
    `Thinking pause of ${(gapMs / 1000).toFixed(1)} s mid-sentence stays on the same line`,
    /set up a meeting/i.test(textOf(s1) ?? "") && /talk about it some more/i.test(textOf(s1) ?? "") && textOf(s2) === null,
    `mic listening after pause: ${heardAfterPause}; line 1 = ${JSON.stringify(textOf(s1))}; line 2 = ${JSON.stringify(textOf(s2))}`,
  );
  await page.context().close();
}

await pauseCase(2600);
await pauseCase(3300);

// Talking while a "detail may be missing" note is showing adds to your version instead of being ignored.
{
  const page = await session();
  await say(page, "could we have a meeting to talk about this");
  await page.waitForFunction(() => document.querySelector('[data-testid="active-segment"] p.lyric')?.innerText.includes("My mum"), null, { timeout: 20000 });
  await page.waitForFunction(() => window.__revoiceSpeech?.isListening());
  await say(page, "my mum agrees with me");
  const issue = await page.waitForSelector('[data-testid="issue-panel"]', { timeout: 20000 }).then(() => true).catch(() => false);
  await sleep(300);
  const canHear = await listening(page);
  await say(page, "and she's happy to talk it through with you");
  await page.waitForFunction(() => document.querySelector('[data-testid="active-segment"] p.lyric')?.innerText.includes("Thank you"), null, { timeout: 25000 }).catch(() => undefined);
  const doc = await readDoc(page);
  const mum = doc.segments[1];
  record(
    "Speaking while a missing-detail note is shown adds it to your version",
    issue && /agrees with me/i.test(textOf(mum) ?? "") && /talk it through/i.test(textOf(mum) ?? "") && mum.status === "completed",
    `note shown: ${issue}; mic listening during note: ${canHear}; saved: ${JSON.stringify(textOf(mum))}; status ${mum.status}`,
  );
  await page.context().close();
}

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
