import { loadEnv } from "../config/env.js";
import { logger as defaultLogger } from "../logger.js";
import type { Logger } from "../logger.js";

/**
 * Minimal OpenAI-compatible chat-completions client (M9). Works with any
 * provider that speaks the OpenAI API (OpenAI, OpenRouter, Groq, local
 * gateways, ...). JSON-mode is requested; the caller owns schema validation.
 *
 * Not the college API: no request budget needed here, but timeouts and one
 * retry for transient failures still apply.
 */

export type FetchFn = typeof globalThis.fetch;

export interface AiClientOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: FetchFn;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class AiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  private readonly log: Logger;

  constructor(options: AiClientOptions = {}, log?: Logger) {
    const env = loadEnv();
    this.baseUrl = (options.baseUrl ?? env.AI_API_BASE_URL).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? env.AI_API_KEY;
    this.model = options.model ?? env.AI_MODEL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.log = (log ?? defaultLogger).child({ module: "ai-client" });
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  get modelName(): string {
    return this.model;
  }

  /**
   * Send the prompt in JSON mode and return the parsed JSON value.
   * Throws on transport/auth errors; JSON parse errors are surfaced as-is
   * so the caller can decide whether to retry or skip.
   */
  async completeJson(messages: ChatMessage[]): Promise<unknown> {
    if (!this.enabled) {
      throw new Error("AI_API_KEY is not configured");
    }
    const body = {
      model: this.model,
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`AI API transient failure (HTTP ${response.status})`);
          if (attempt === 1) continue;
          throw lastError;
        }
        if (!response.ok) {
          throw new Error(`AI API error (HTTP ${response.status})`);
        }
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
          throw new Error("AI API returned an empty completion");
        }
        return parseJsonObject(content);
      } catch (err) {
        lastError = err;
        if (attempt === 1 && isTransient(err)) continue;
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function isTransient(err: unknown): boolean {
  return err instanceof Error && /transient|timeout|abort/i.test(err.message);
}

/** Tolerates markdown fences some providers wrap around JSON. */
function parseJsonObject(content: string): unknown {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed: unknown = JSON.parse(stripped);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI completion is not a JSON object");
  }
  return parsed;
}
