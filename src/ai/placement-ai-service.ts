import type { Logger } from "../logger.js";
import type { AiClient } from "./client.js";
import {
  EMPTY_EXTRACTION,
  placementExtractionSchema,
  type PlacementExtraction,
} from "./schema.js";
import { verifyExtraction } from "./verify.js";

/**
 * PlacementAIService (M9): raw placement notice text → structured, verified
 * JSON. Discipline enforced by design:
 *
 * 1. The model must emit null for anything not explicitly stated.
 * 2. Output is Zod-validated — invalid shapes are rejected, never trusted.
 * 3. A deterministic verifier re-checks every reported number against the
 *    source text; unverifiable values are removed (see verify.ts).
 *
 * Trivial inputs are skipped without an API call.
 */

const MIN_TEXT_LENGTH = 80;
const MAX_TEXT_CHARS = 60_000;

const SYSTEM_PROMPT = `You extract structured placement information from Indian college placement notices.
Return ONLY a JSON object with exactly these keys:
{"role","minimumCgpa","sscPercentage","hscPercentage","diplomaPercentage","allowedBranches","graduationYears","backlogPolicy","skills","locations","salary","stipend","deadline","selectionStages","confidence","notes"}

Hard rules:
- Emit null for ANY field that is not explicitly stated in the text. Never guess, never infer defaults, never fabricate numbers.
- minimumCgpa/sscPercentage/hscPercentage/diplomaPercentage: numbers as written (e.g. 7.5, 70).
- graduationYears: years explicitly mentioned (e.g. [2028]).
- backlogPolicy: "active_allowed" | "no_active_backlogs" | "no_backlogs", or null if unstated.
- deadline: "YYYY-MM-DD" only if an application deadline is explicitly stated.
- confidence: "high" | "medium" | "low" for the extraction overall.
- notes: array of strings flagging anything uncertain, ambiguous, or contradictory. Use notes instead of guessing.`;

export class PlacementAIService {
  constructor(
    private readonly client: AiClient,
    private readonly log: Logger,
  ) {}

  /** Model identifier persisted alongside extractions for provenance. */
  get modelName(): string {
    return this.client.modelName;
  }

  /**
   * Extract structured data from notice text. Returns null when the input
   * is too short to be meaningful or the AI client is not configured.
   */
  async extract(text: string): Promise<PlacementExtraction | null> {
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT_LENGTH) {
      this.log.debug(
        { length: trimmed.length },
        "text too short for AI extraction; skipping",
      );
      return null;
    }
    if (!this.client.enabled) {
      this.log.debug("AI client not configured; skipping extraction");
      return null;
    }

    let raw: unknown;
    try {
      raw = await this.client.completeJson([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: trimmed.slice(0, MAX_TEXT_CHARS),
        },
      ]);
    } catch (err) {
      // Unparseable/failed completions are never trusted — discard cleanly.
      this.log.warn({ err: String(err) }, "AI completion failed; discarding");
      return null;
    }

    const parsed = placementExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      this.log.warn({ issues }, "AI output failed schema validation; discarding");
      return null;
    }

    const { extraction, removed } = verifyExtraction(parsed.data, trimmed);
    if (removed.length > 0) {
      this.log.warn(
        { removed },
        "unverifiable numeric values removed by deterministic verification",
      );
    }
    return extraction;
  }

  /** Neutral result for empty/short inputs (kept distinct from null = skip). */
  static empty(): PlacementExtraction {
    return { ...EMPTY_EXTRACTION, notes: ["insufficient text for extraction"] };
  }
}
