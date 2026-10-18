# Revoice

Rewrite any text in your own words, by speaking.

Paste an email (say, one ChatGPT wrote that sounds nothing like you). Revoice splits it into short ideas and shows them like synced lyrics. You read each idea and say it the way you'd naturally say it. Revoice transcribes you live, notices when you've finished, checks that your version still says the same thing (names, numbers, dates, requests, commitments, conditions, negatives), and glides on to the next idea. At the end you have the whole document in your own words.

**The AI protects the meaning. You control the words.** Revoice never rewrites what you said; it only fixes capitalisation and punctuation (plus fillers like "um", if you want), and any other change is a suggestion you approve.

---

## Quick start

```bash
cd revoice
npm install
cp .env.example .env.local     # then put your OpenAI key in OPENAI_API_KEY
npm run dev                    # http://localhost:3000
```

Use **Chrome or Edge** for live speech recognition (see *Browser support*). Without an API key the app still works end to end, using its offline checker.

### Configuration (`.env.local`, server-side only)

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Enables AI segmentation, meaning checks, the final review and OpenAI transcription. Never sent to the browser. |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Model for segmentation/checks/review. |
| `OPENAI_REASONING_EFFORT` | `low` | `none`/`minimal`/`low`/`medium`/`high`, or `off` for models that don't accept it. |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | Used by the optional OpenAI speech provider. |
| `OPENAI_BASE_URL` | — | Optional OpenAI-compatible endpoint. |
| `NEXT_PUBLIC_ENABLE_SIMULATED_SPEECH` | — | `1` exposes the simulated speech provider in production builds (testing only; always on in `next dev`). |

If your machine sends traffic through an HTTPS proxy, start Node with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) so the server's OpenAI calls use it.

### Deploying

Revoice needs a server for its API routes (that's where the key lives), so it **can't be hosted on GitHub Pages**. Deploy the `revoice/` folder to Vercel (set it as the project root and add the env vars), or anywhere that runs `npm run build && npm start`. The API routes have no authentication, so anyone who can reach a public deployment can spend your OpenAI credit. Put it behind your host's password protection, or add auth, before sharing the URL.

---

## Using it

1. Paste text, optionally add a title, **Start rewriting**.
2. Press **Space** (or the mic). Read the highlighted idea and say it your way.
3. Stop talking. After ~1.7 s of silence (adapting to how you pause) Revoice finishes the segment, checks it, shows a ✓ and moves on. The mic stays on, so a whole email can be done hands-free.
4. If something important is missing or changed, a calm note appears with **Add it in my own words**, **Review original**, **Keep my version** or **Say it again**. Minor differences never stop you.
5. When every segment is done, the **Review** runs a whole-document check (missing info, repeats, contradictions, unclear references). Proposed fixes are only applied if you approve each one.
6. **Export**: copy, download `.txt` / `.md`, or edit the full text first.

Everything autosaves in the browser after every change: close the tab and resume later from the home page.

| Key | Action |
|---|---|
| Space | Start / pause mic |
| Enter | Done with this segment |
| ↑ ↓ (← →) | Previous / next segment |
| R | Redo segment |
| E | Edit or type your version |
| U, ⌘/Ctrl Z | Undo to previous version |
| O | Use original wording (names, sign-offs) |
| S | Skip |
| A / K | Add missing detail / Keep my version (when flagged) |
| D | Show details to keep |
| ? | All shortcuts |

Settings (gear icon): auto-advance and its delay, silence threshold, adaptive pauses, cleanup mode (minimal / suggest), filler removal, speech provider and language, text size, high contrast, reduced motion, AI on/off, delete all data, and **Adjust segments** (merge / split).

---

## Browser support

| Speech provider | Works in | Notes |
|---|---|---|
| **Browser (default)** – Web Speech API | Chrome, Edge, Safari | Live word-by-word text. Chrome/Edge send audio to Google/Microsoft for recognition. **Not available in Firefox.** |
| **OpenAI** | Any browser with `MediaRecorder` (incl. Firefox) | Audio for each segment goes to your server, then to OpenAI, then is discarded. Live text refreshes every ~2.5 s rather than per word. |
| Simulated | Dev/test only | Scripted speech for automated tests; always shows a "Simulated speech" badge. |

You can always type or correct your version instead of speaking (**E**), so the app is usable without perfect, or any, speech recognition.

---

## How it works

```
src/
  lib/
    types.ts                  All document/segment/check interfaces
    document/
      segmentation.ts         Exact-span units → segments; merge/split; validation; AI-grouping repair
      operations.ts           Pure state transitions (revisions, undo/redo, checks, status, progress)
      reconstruct.ts          Rebuild text using the original's own spacing; .txt/.md export
    meaning/
      cleanup.ts              The only automatic edits (capitals, punctuation, fillers)
      heuristics.ts           Offline checker: numbers, names, dates, negations
      review-heuristics.ts    Offline whole-document review
    speech/
      types.ts                SpeechProvider interface (swap providers without touching UI)
      web-speech.ts           Browser recogniser
      openai-transcription.ts MediaRecorder + VAD + /api/transcribe
      simulated.ts            Test provider
      end-of-speech.ts        Adaptive silence detector
      audio-level.ts          Waveform + voice-activity detection
    storage/store.ts          DocumentStore interface + localStorage implementation
    services/                 Segmenter / checker with automatic offline fallback
    api/                      Shared request/response contracts + fetch client (timeouts, no throws)
    server/                   OpenAI client, prompts, route helpers (server-only)
  app/api/                    status, segment, check, review, transcribe
  components/                 Landing, session screen (lyrics view, recorder dock, issue panel,
                              preview, review, export, segment editor), settings
```

**Segmentation never alters text.** The original is first cut deterministically into sentence/clause *units*, each an exact `[start, end)` span. The model only chooses which consecutive units form a segment (and lists each segment's key points). Groups that cross a line break or exceed 35 words are repaired deterministically, and the final mapping is validated. Anything invalid falls back to local grouping. Users can merge and split, and spans stay exact.

**Meaning checks** send the segment, its neighbours, the user's previous rewrite, the key points and the transcript to the model with a strict JSON schema. The prompt tells the model to ignore wording, tone and formality, and to flag only lost or changed facts, requests, commitments, names, dates, numbers, conditions and negations. "Important" issues pause the flow; "minor" ones don't. The verdict is derived from the issues on the server, so they can't disagree.

**Failure handling.** Every network call has a timeout and resolves to a result instead of throwing. If the AI is unreachable, the offline checker runs, the user carries on, and the segment is re-checked by the AI automatically when the connection returns. Saving is local and synchronous, so a network failure can't lose work. Late speech results are tagged with the segment they were recorded for, so they can never land on the wrong segment or be applied twice.

---

## Privacy

- Documents, transcripts and history live only in your browser (`localStorage`). Delete one from the home page, or everything in Settings.
- With AI on, segment text and your spoken version are sent to OpenAI (with `store: false`). Turn AI off in Settings to keep text on-device (offline checks only).
- No audio is recorded or kept by Revoice. With the browser provider your browser's speech service hears you; with the OpenAI provider each utterance is forwarded to OpenAI and discarded.
- The server logs no document content: errors are logged as type/status only.

---

## Testing

```bash
npm test                 # unit tests (vitest)
npm run lint             # TypeScript

# End-to-end, in headless Chromium against a production build:
NEXT_PUBLIC_ENABLE_SIMULATED_SPEECH=1 npm run build && npm start
BASE_URL=http://localhost:3000 node e2e/run.mjs              # AI on (needs OPENAI_API_KEY)
OFFLINE=1 BASE_URL=http://localhost:3000 node e2e/run.mjs    # AI off, offline checker

# Meaning-checker accuracy against labelled cases (real model):
BASE_URL=http://localhost:3000 RUNS=5 node e2e/meaning-eval.mjs
```

The e2e test pastes a realistic multi-paragraph email and drives the whole flow with simulated speech, while segmentation, checks and the review hit the real server and model. It covers:

- a correct rephrase;
- an omitted detail;
- a changed number;
- a reversed negation;
- a long mid-sentence pause;
- restarting a segment mid-speech;
- a refresh halfway through;
- a network failure during a check, with an automatic AI re-check afterwards;
- a speech-recognition error;
- typing instead of speaking;
- keeping the original wording;
- editing an earlier segment;
- the final review;
- copy and `.txt`/`.md` downloads;
- checking that the final text keeps the meaning and the user's wording.

## Known limitations

- The offline checker can only verify numbers, names, dates and negatives. It can't tell a paraphrase from an omission, so it lets a paraphrased omission through. The AI check (and the final AI review) catch those.
- Web Speech recognition quality and availability depend on the browser vendor's service; Firefox has none (use the OpenAI provider or type).
- Plain-text import only for now (`OriginalDocument.format` leaves room for other importers).
- Storage is per-browser; there is no sync between devices yet (`DocumentStore` is the seam for a backend).
