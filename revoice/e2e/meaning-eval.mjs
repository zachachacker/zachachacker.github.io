/**
 * Measures the meaning checker against labelled cases (calls the running
 * server, i.e. the real model). Each case runs RUNS times; we report how often
 * the "should pause the user" decision is right, plus latency.
 *
 *   BASE_URL=http://localhost:3000 RUNS=3 node e2e/meaning-eval.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 3);

const CASES = [
  // Should pause (an important issue).
  { block: true, name: "omits willingness to discuss", original: "My mum supports this request and would be happy to discuss it with you.", rewrite: "My mum agrees with me.", keyPoints: ["Your mum supports this request", "Your mum would be happy to discuss it"] },
  { block: true, name: "changes a number", original: "The revised budget now comes to £2,400 rather than the original £3,100.", rewrite: "The new budget's two thousand five hundred instead of three thousand one hundred." },
  { block: true, name: "reverses a negation", original: "Please note that I will not be able to start before 14 September.", rewrite: "Just so you know I can start before the 14th of September." },
  { block: true, name: "changes a day", original: "I am available on Thursday or Friday afternoon.", rewrite: "I'm free Wednesday or Friday afternoon." },
  { block: true, name: "drops a condition", original: "We can go ahead with the order if the budget is approved by Monday.", rewrite: "We can go ahead with the order." },
  { block: true, name: "flips who acts", original: "Could you send me the signed contract by Friday?", rewrite: "I'll send you the signed contract by Friday." },
  // Should not pause.
  { block: false, name: "free rephrase of a request", original: "I would be grateful if we could arrange a meeting to discuss this further.", rewrite: "Could we have a meeting to talk about this?" },
  { block: false, name: "drops politeness filler", original: "I hope this message finds you well. I am writing to follow up on our conversation last Tuesday.", rewrite: "Hope you're good. Just following up on what we talked about Tuesday." },
  { block: false, name: "informal, same meaning", original: "I found the difference to be substantial.", rewrite: "I honestly found the difference massive." },
  { block: false, name: "mis-heard word", original: "I am available on Thursday or Friday afternoon.", rewrite: "I'm free thursday or fry day afternoon." },
  { block: false, name: "casual greeting", original: "Dear Dr. Patel,", rewrite: "Hi Dr Patel," },
  { block: false, name: "loose but complete after adding a detail", original: "My mum supports this request and would be happy to discuss it with you.", rewrite: "My mum agrees with me. And she's happy to talk it through with you.", keyPoints: ["Your mum supports this request", "Your mum would be happy to discuss it"] },
  { block: false, name: "thanks, shorter", original: "Thank you very much for your time and consideration.", rewrite: "Thanks so much for your time." },
];

let right = 0, total = 0;
const times = [];
for (const c of CASES) {
  const outcomes = [];
  for (let i = 0; i < RUNS; i++) {
    const t = Date.now();
    const res = await fetch(`${BASE}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ original: c.original, rewrite: c.rewrite, keyPoints: (c.keyPoints ?? []).map((text) => ({ kind: "fact", text })) }),
    });
    times.push(Date.now() - t);
    const d = await res.json();
    const blocked = d.issues.some((x) => x.severity === "important");
    outcomes.push(blocked);
    total++;
    if (blocked === c.block) right++;
  }
  const ok = outcomes.filter((b) => b === c.block).length;
  console.log(`${ok === RUNS ? "ok  " : "MISS"} ${ok}/${RUNS}  ${c.block ? "[should pause]" : "[should pass] "} ${c.name}`);
}
times.sort((a, b) => a - b);
console.log(`\naccuracy ${right}/${total} (${((100 * right) / total).toFixed(0)}%) · median ${times[Math.floor(times.length / 2)]} ms · p90 ${times[Math.floor(times.length * 0.9)]} ms`);
