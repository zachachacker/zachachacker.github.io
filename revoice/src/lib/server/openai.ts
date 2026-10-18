import "server-only";
import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";

/**
 * Server-only OpenAI access. The API key is read from the environment and
 * never leaves the server. Document text is never logged: errors are
 * reported by status/name only.
 */

let client: OpenAI | null | undefined;

export function getOpenAI(): OpenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  client = apiKey
    ? new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        timeout: 30_000,
        maxRetries: 1,
      })
    : null;
  return client;
}

export function chatModel(): string {
  return process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

export function transcribeModel(): string {
  return process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
}

function reasoningEffort(): ReasoningEffort | undefined {
  const v = (process.env.OPENAI_REASONING_EFFORT ?? "low").trim();
  if (!v || v === "off") return undefined;
  return v as ReasoningEffort;
}

export class AIUnavailableError extends Error {
  constructor(message = "AI is not configured on the server") {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export class AIResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIResponseError";
  }
}

/**
 * One chat completion constrained to a JSON schema (OpenAI Structured
 * Outputs, strict mode), parsed and returned.
 */
export async function structuredCompletion<T>(opts: {
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<T> {
  const openai = getOpenAI();
  if (!openai) throw new AIUnavailableError();
  const effort = reasoningEffort();
  const res = await openai.chat.completions.create(
    {
      model: chatModel(),
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.name, strict: true, schema: opts.schema },
      },
      // Don't let OpenAI keep these completions for its own product features.
      store: false,
    },
    { signal: opts.signal },
  );
  const msg = res.choices[0]?.message;
  if (!msg) throw new AIResponseError("Empty response");
  if (msg.refusal) throw new AIResponseError("Model declined the request");
  if (res.choices[0].finish_reason === "length") throw new AIResponseError("Response was cut off");
  try {
    return JSON.parse(msg.content ?? "") as T;
  } catch {
    throw new AIResponseError("Response was not valid JSON");
  }
}

/** Log an error without any user content. */
export function logError(route: string, err: unknown) {
  const e = err as { name?: string; status?: number; code?: string };
  console.error(`[revoice] ${route} failed: ${e?.name ?? "Error"} status=${e?.status ?? "-"} code=${e?.code ?? "-"}`);
}
