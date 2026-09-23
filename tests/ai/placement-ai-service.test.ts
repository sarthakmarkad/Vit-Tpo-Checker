import { describe, expect, it, vi } from "vitest";
import { logger } from "../../src/logger.js";
import { AiClient } from "../../src/ai/client.js";
import { PlacementAIService } from "../../src/ai/placement-ai-service.js";
import type { PlacementExtraction } from "../../src/ai/schema.js";

/**
 * AI client + service tests with a mocked fetch — no external calls.
 */

const NOTICE = [
  "BMC Software — Internship + Performance-based PPO for the 2028 batch.",
  "Eligibility: minimum CGPA 7.5, SSC 70%, HSC 70%. No active backlogs allowed.",
  "CTC: 16 LPA. Stipend: 40000 per month during the internship.",
  "Selection process: online aptitude test, technical interview, HR interview.",
  "Last date to apply: 2026-08-17.",
].join(" ");

function aiFetch(payload: unknown, calls?: string[]): typeof globalThis.fetch {
  return (async (url: string | URL | Request) => {
    calls?.push(String(url));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

function completion(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

const GOOD_EXTRACTION: PlacementExtraction = {
  role: "Internship + PPO",
  minimumCgpa: 7.5,
  sscPercentage: 70,
  hscPercentage: 70,
  diplomaPercentage: null,
  allowedBranches: [],
  graduationYears: [2028],
  backlogPolicy: "no_active_backlogs",
  skills: [],
  locations: [],
  salary: "16 LPA",
  stipend: "40000",
  deadline: "2026-08-17",
  selectionStages: ["Aptitude", "Technical Interview", "HR Interview"],
  confidence: "high",
  notes: [],
};

describe("AiClient", () => {
  it("posts to chat/completions with JSON mode and parses the content", async () => {
    const calls: string[] = [];
    const client = new AiClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "key-test",
        model: "test-model",
        fetchFn: aiFetch(completion(JSON.stringify({ a: 1 })), calls),
      },
      logger,
    );
    const result = await client.completeJson([
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ]);
    expect(result).toEqual({ a: 1 });
    expect(calls).toEqual(["https://api.example.com/v1/chat/completions"]);
  });

  it("tolerates markdown fences around the JSON", async () => {
    const client = new AiClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "k",
        model: "m",
        fetchFn: aiFetch(completion('```json\n{"b": 2}\n```')),
      },
      logger,
    );
    expect(await client.completeJson([{ role: "user", content: "u" }])).toEqual({ b: 2 });
  });

  it("is disabled without an API key", async () => {
    const client = new AiClient({ apiKey: "" }, logger);
    expect(client.enabled).toBe(false);
    await expect(client.completeJson([])).rejects.toThrow(/AI_API_KEY/);
  });

  it("retries once on a transient 500 then succeeds", async () => {
    let n = 0;
    const flaky = (async () => {
      n += 1;
      if (n === 1) {
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify(completion('{"ok": true}')), {
        status: 200,
      });
    }) as unknown as typeof globalThis.fetch;
    const client = new AiClient(
      { baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchFn: flaky },
      logger,
    );
    expect(await client.completeJson([{ role: "user", content: "u" }])).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it("does not retry permanent client errors (401)", async () => {
    let n = 0;
    const unauthorized = (async () => {
      n += 1;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof globalThis.fetch;
    const client = new AiClient(
      { baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchFn: unauthorized },
      logger,
    );
    await expect(client.completeJson([{ role: "user", content: "u" }])).rejects.toThrow(
      /HTTP 401/,
    );
    expect(n).toBe(1);
  });
});

describe("PlacementAIService", () => {
  function serviceWith(content: string) {
    const client = new AiClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "k",
        model: "test-model",
        fetchFn: aiFetch(completion(content)),
      },
      logger,
    );
    return new PlacementAIService(client, logger);
  }

  it("extracts, validates and verifies a good completion", async () => {
    const svc = serviceWith(JSON.stringify(GOOD_EXTRACTION));
    const result = await svc.extract(NOTICE);
    expect(result?.minimumCgpa).toBe(7.5);
    expect(result?.deadline).toBe("2026-08-17");
    expect(result?.notes).toHaveLength(0);
  });

  it("strips hallucinated numbers the text does not contain", async () => {
    const hallucinated = { ...GOOD_EXTRACTION, minimumCgpa: 9.0, confidence: "high" };
    const result = await serviceWith(JSON.stringify(hallucinated)).extract(NOTICE);
    expect(result?.minimumCgpa).toBeNull();
    expect(result?.notes.join(" ")).toMatch(/not found in source text/);
  });

  it("returns null (discarded) when the model output breaks the schema", async () => {
    const result = await serviceWith(JSON.stringify({ role: 123 })).extract(NOTICE);
    expect(result).toBeNull();
  });

  it("returns null when the model emits non-JSON", async () => {
    const result = await serviceWith("I cannot answer that.").extract(NOTICE);
    expect(result).toBeNull();
  });

  it("skips short inputs without any API call", async () => {
    const fetchFn = vi.fn();
    const client = new AiClient(
      { baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchFn: fetchFn as never },
      logger,
    );
    const svc = new PlacementAIService(client, logger);
    expect(await svc.extract("too short")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
