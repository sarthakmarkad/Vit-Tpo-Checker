import type { PlacementExtraction, VerifiedNumericField } from "./schema.js";

/**
 * Deterministic post-verification of model output. The AI is only allowed to
 * report numbers that literally occur in the source text — anything else is
 * treated as a hallucination attempt: nulled and recorded in notes.
 *
 * This is intentionally NOT an LLM judgment: plain string matching is cheap,
 * explainable, and cannot be fooled by model confidence.
 */

function valueVariants(value: number): string[] {
  return [
    String(value),
    value.toFixed(2).replace(/\.?0+$/, ""),
    value.toFixed(1),
    String(value).replace(".", ","), // Indian notation: "7,5 CGPA"
  ];
}

/** Whole-token numeric match: "8" must not match inside "2028". */
function textContainsNumber(text: string, variant: string): boolean {
  const escaped = variant.replace(".", "\\.");
  const pattern = new RegExp(`(?<![\\d.,])${escaped}(?![\\d])`);
  return pattern.test(text);
}

export function verifyExtraction(
  extraction: PlacementExtraction,
  sourceText: string,
): { extraction: PlacementExtraction; removed: VerifiedNumericField[] } {
  const notes = [...extraction.notes];
  const removed: VerifiedNumericField[] = [];
  const out: PlacementExtraction = { ...extraction };

  for (const field of ["minimumCgpa", "sscPercentage", "hscPercentage", "diplomaPercentage"] as const) {
    const value = out[field];
    if (value === null) continue;
    const found = valueVariants(value).some((v) => textContainsNumber(sourceText, v));
    if (!found) {
      notes.push(
        `removed ${field}: value ${value} not found in source text (possible hallucination)`,
      );
      out[field] = null;
      removed.push(field);
    }
  }

  out.graduationYears = out.graduationYears.filter((year) => {
    if (textContainsNumber(sourceText, String(year))) return true;
    notes.push(`removed graduation year ${year}: not found in source text`);
    return false;
  });

  if (removed.length > 0 && out.confidence === "high") {
    out.confidence = "medium";
  }
  return { extraction: { ...out, notes }, removed };
}
