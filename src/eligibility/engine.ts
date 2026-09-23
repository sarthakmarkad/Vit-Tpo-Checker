/**
 * Deterministic eligibility engine (M11). NO LLM HERE — every check is a
 * plain comparison that can be explained line by line. AI interpretation
 * may later refine the "uncertain" cases, but never silently overrides them.
 *
 * Status semantics:
 *  - eligible:    every stated criterion is verifiably satisfied
 *  - not_eligible: at least one stated criterion verifiably fails
 *  - uncertain:   nothing failed, but some criterion could not be evaluated
 *                 (missing on either side, or naming ambiguity)
 */

export interface EligibilityCheck {
  criterion: string;
  required: string;
  actual: string;
  status: "satisfied" | "failed" | "unknown";
}

export interface EligibilityResult {
  status: "eligible" | "not_eligible" | "uncertain";
  checks: EligibilityCheck[];
  reasons: string[];
}

export interface PlacementEligibilityInput {
  minimumCgpa?: number | null;
  sscPercentage?: number | null;
  hscPercentage?: number | null;
  diplomaPercentage?: number | null;
  graduationYears?: number[] | null;
  programs?: string[] | null;
  activeBacklogsAllowed?: boolean | null;
  deadBacklogsAllowed?: boolean | null;
}

export interface ProfileEligibilityInput {
  branch?: string | null;
  graduationYear?: number | null;
  cgpa?: number | null;
  sscPercentage?: number | null;
  hscPercentage?: number | null;
  diplomaPercentage?: number | null;
  activeBacklogs?: number | null;
  deadBacklogs?: number | null;
}

function fmt(n: number | string | null | undefined): string {
  return n === null || n === undefined ? "not set" : String(n);
}

interface NumericRule {
  criterion: string;
  unit: string;
  required: number | null | undefined;
  actual: number | null | undefined;
}

function evaluateNumeric(rule: NumericRule): EligibilityCheck {
  if (rule.required === null || rule.required === undefined) {
    return {
      criterion: rule.criterion,
      required: "not stated",
      actual: fmt(rule.actual),
      status: "satisfied", // no requirement → nothing to fail
    };
  }
  if (rule.actual === null || rule.actual === undefined) {
    return {
      criterion: rule.criterion,
      required: `≥ ${rule.required}${rule.unit}`,
      actual: "not set",
      status: "unknown",
    };
  }
  const ok = rule.actual >= rule.required;
  return {
    criterion: rule.criterion,
    required: `≥ ${rule.required}${rule.unit}`,
    actual: `${rule.actual}${rule.unit}`,
    status: ok ? "satisfied" : "failed",
  };
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/**
 * Common Indian branch abbreviations → expansions used for token matching.
 * Deliberately tiny and explicit; anything outside this map falls through
 * to "unknown" rather than a guess.
 */
const BRANCH_ABBREVIATIONS: Record<string, string[]> = {
  cse: ["computer science"],
  cs: ["computer science"],
  it: ["information technology"],
  ai: ["artificial intelligence"],
  ml: ["machine learning"],
  ece: ["electronics communication"],
  eee: ["electrical electronics"],
  aids: ["artificial intelligence data science"],
  iot: ["internet of things"],
};

function expand(tokensList: string[]): string[] {
  const out = [...tokensList];
  for (const t of tokensList) {
    const expansion = BRANCH_ABBREVIATIONS[t];
    if (expansion) out.push(...expansion.flatMap((e) => tokens(e)));
  }
  return out;
}

/**
 * Branch match is inherently fuzzy ("BTech CSE" vs "Computer Science").
 * A hit is conclusive; a miss is reported as unknown — never a fail —
 * so no candidate is rejected over naming variance alone.
 */
function evaluateBranch(
  programs: string[] | null | undefined,
  branch: string | null | undefined,
): EligibilityCheck {
  if (!programs || programs.length === 0) {
    return {
      criterion: "Branch",
      required: "not stated",
      actual: fmt(branch),
      status: "satisfied",
    };
  }
  if (!branch) {
    return {
      criterion: "Branch",
      required: programs.join(", "),
      actual: "not set",
      status: "unknown",
    };
  }
  const branchTokens = tokens(branch);
  const expanded = expand(branchTokens);
  const matched = programs.some((p) => {
    const programTokens = new Set(tokens(p));
    if (expanded.some((t) => programTokens.has(t))) return true;
    const lowered = p.toLowerCase();
    return expanded.some((t) => t.length >= 3 && lowered.includes(t));
  });
  return {
    criterion: "Branch",
    required: programs.join(", "),
    actual: branch,
    status: matched ? "satisfied" : "unknown",
  };
}

function evaluateGraduationYear(
  years: number[] | null | undefined,
  graduationYear: number | null | undefined,
): EligibilityCheck {
  if (!years || years.length === 0) {
    return {
      criterion: "Graduation year",
      required: "not stated",
      actual: fmt(graduationYear),
      status: "satisfied",
    };
  }
  if (graduationYear === null || graduationYear === undefined) {
    return {
      criterion: "Graduation year",
      required: years.join(" / "),
      actual: "not set",
      status: "unknown",
    };
  }
  const ok = years.includes(graduationYear);
  return {
    criterion: "Graduation year",
    required: years.join(" / "),
    actual: String(graduationYear),
    status: ok ? "satisfied" : "failed",
  };
}

function evaluateBacklogs(
  allowed: boolean | null | undefined,
  count: number | null | undefined,
  label: string,
): EligibilityCheck {
  if (allowed === null || allowed === undefined) {
    return {
      criterion: label,
      required: "not stated",
      actual: fmt(count),
      status: "satisfied",
    };
  }
  if (count === null || count === undefined) {
    return {
      criterion: label,
      required: allowed ? "allowed" : "not allowed",
      actual: "not set",
      status: "unknown",
    };
  }
  const hasAny = count > 0;
  const ok = allowed || !hasAny;
  return {
    criterion: label,
    required: allowed ? "allowed" : "none allowed",
    actual: String(count),
    status: ok ? "satisfied" : "failed",
  };
}

export function evaluateEligibility(
  placement: PlacementEligibilityInput,
  profile: ProfileEligibilityInput,
): EligibilityResult {
  const checks: EligibilityCheck[] = [
    evaluateNumeric({
      criterion: "CGPA",
      unit: "",
      required: placement.minimumCgpa,
      actual: profile.cgpa,
    }),
    evaluateNumeric({
      criterion: "SSC",
      unit: "%",
      required: placement.sscPercentage,
      actual: profile.sscPercentage,
    }),
    evaluateNumeric({
      criterion: "HSC",
      unit: "%",
      required: placement.hscPercentage,
      actual: profile.hscPercentage,
    }),
    evaluateNumeric({
      criterion: "Diploma",
      unit: "%",
      required: placement.diplomaPercentage,
      actual: profile.diplomaPercentage,
    }),
    evaluateGraduationYear(placement.graduationYears, profile.graduationYear),
    evaluateBranch(placement.programs, profile.branch),
    evaluateBacklogs(
      placement.activeBacklogsAllowed,
      profile.activeBacklogs,
      "Active backlogs",
    ),
    evaluateBacklogs(
      placement.deadBacklogsAllowed,
      profile.deadBacklogs,
      "Dead backlogs",
    ),
  ];

  const failed = checks.filter((c) => c.status === "failed");
  const unknown = checks.filter((c) => c.status === "unknown");

  let status: EligibilityResult["status"];
  if (failed.length > 0) {
    status = "not_eligible";
  } else if (unknown.length > 0) {
    status = "uncertain";
  } else {
    status = "eligible";
  }

  const reasons = [
    ...failed.map((c) => `${c.criterion}: required ${c.required}, you have ${c.actual}`),
    ...unknown.map((c) => `${c.criterion}: cannot verify (${c.required} vs ${c.actual})`),
  ];

  return { status, checks, reasons };
}

export function statusIcon(status: EligibilityResult["status"]): string {
  switch (status) {
    case "eligible":
      return "🟢";
    case "not_eligible":
      return "🔴";
    case "uncertain":
      return "🟡";
  }
}
