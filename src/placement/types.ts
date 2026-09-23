/**
 * Internal domain model — the rest of the application depends on THESE types,
 * never on the raw TPO wire format. Fields are optional only when the source
 * can legitimately omit them; nothing is invented.
 */

export interface PlacementOpportunity {
  /** TPO offering id, e.g. "5705" — the stable identity. */
  externalId: string;
  companyName: string;
  offeringCode?: string | undefined;
  /** Max package in LPA (TPO's numeric package field). */
  package?: number | undefined;
  minPackage?: number | undefined;
  packageUnit: "LPA";
  placementType?: string | undefined;
  internshipType?: string | undefined;
  companyType?: string | undefined;
  academicYear?: string | undefined;

  registrationStart?: Date | undefined;
  registrationEnd?: Date | undefined;

  /** Graduation CGPA/CPI requirement. */
  minimumCgpa?: number | undefined;
  sscPercentage?: number | undefined;
  hscPercentage?: number | undefined;
  diplomaPercentage?: number | undefined;

  activeBacklogsAllowed?: boolean | undefined;
  deadBacklogsAllowed?: boolean | undefined;
  placedStudentsAllowed?: boolean | undefined;
  yearDownAllowed?: boolean | undefined;
  higherStudiesAllowed?: boolean | undefined;

  programs?: string[] | undefined;
  /** Graduating batch years, from the details programlist (e.g. [2028]). */
  graduationYears?: number[] | undefined;
  organizations?: string[] | undefined;
  skills?: string[] | undefined;
  locations?: string[] | undefined;

  minStipend?: number | undefined;
  maxStipend?: number | undefined;
  stipendDescription?: string | undefined;

  description?: string | undefined;
  jobDescription?: string | undefined;
  bondDescription?: string | undefined;

  selectionProcess?: string[] | undefined;

  /** Only present in the list payload; details omit it. */
  isActive?: boolean | undefined;

  rawData: unknown;
}

export interface NormalizedAttachment {
  externalId: string;
  filename: string;
  /** S3 object key — stable. Signed URLs are never persisted. */
  objectKey?: string | undefined;
}

export interface PlacementRequirementMeta {
  academicYear?: string;
  semester?: string;
  instructions: string[];
  specificCriteria?: string | null;
  remark?: string | null;
}
