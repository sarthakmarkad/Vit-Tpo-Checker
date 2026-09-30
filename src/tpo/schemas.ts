import { z } from "zod";

/**
 * Wire-contract validation for TPO API responses.
 * Intentionally light: validates only the fields the platform relies on,
 * preserving the rest via loose objects so `rawData` stays complete.
 * Domain normalization lives in src/placement (M3).
 */

export const rawCompanyOfferingSchema = z.looseObject({
  id: z.number(),
  company: z.string(),
  company_code: z.string().nullish(),
  minPackage: z.number().nullish(),
  maxPackage: z.number().nullish(),
  placementtype: z.string().nullish(),
  companytype: z.string().nullish(),
  academicyear: z.string().nullish(),
  semester: z.string().nullish(),
  regStartdatenew: z.string().nullish(),
  regEnddatenew: z.string().nullish(),
  regStarttime: z.string().nullish(),
  regEndtime: z.string().nullish(),
  regStartdate: z.string().nullish(),
  regEnddate: z.string().nullish(),
  isactive: z.boolean().nullish(),
  internshiptype: z.string().nullish(),
  skill: z.array(z.unknown()).nullish(),
  industry: z.array(z.unknown()).nullish(),
  tpoprogram: z.array(z.string()).nullish(),
  programnew: z.array(z.string().nullish()).nullish(),
  organization: z.array(z.string()).nullish(),
});

export const rawOfferingListSchema = z.looseObject({
  status: z.string(),
  company_list: z.array(rawCompanyOfferingSchema),
});

export const rawSelectionRoundSchema = z.looseObject({
  round_number: z.number(),
  companyround: z.string(),
  isfinal: z.boolean(),
});

export const rawCriteriaSchema = z.looseObject({
  id: z.number().optional(),
  degree: z.string(),
  percentage: z.number(),
  program: z.string().nullish(),
  criteria_number: z.number().optional(),
});

export const rawOfferingDetailsSchema = z.looseObject({
  msg: z.string(),
  code: z.string(),
  company_name: z.string(),
  selction_procedure: z.array(rawSelectionRoundSchema),
  criteria: z.array(rawCriteriaSchema),
  minpackage: z.number().nullish(),
  maxpackage: z.number().nullish(),
  minstipend: z.number().nullish(),
  maxstipend: z.number().nullish(),
  placementtype: z.string().nullish(),
  description: z.string().nullish(),
  job_description: z.string().nullish(),
  backlog: z.boolean().nullish(),
  is_dead_backlog_allowed: z.boolean().nullish(),
  is_live_backlog_allowed: z.boolean().nullish(),
  isplacedstudentallowed: z.boolean().nullish(),
  isinternstudentallowed: z.boolean().nullish(),
  isyeardownallowed: z.boolean().nullish(),
  ishigherstudiesallowed: z.boolean().nullish(),
  programlist: z.array(
    z.looseObject({
      org: z.string().nullish(),
      // College sends numbers for some drives and free text ("Third Year",
      // "BTech") for others — accept both, normalize downstream.
      year: z.union([z.number(), z.string()]).nullish(),
      program: z.string().nullish(),
    }),
  ),
  locations: z.array(z.unknown()).nullish(),
  companyoffering: z.looseObject({ id: z.number() }),
});

export const rawAttachmentSchema = z.looseObject({
  id: z.number(),
  filename: z.string(),
  filepath: z.string().nullish(),
  fileUrl: z.string().nullish(),
});

export const rawAttachmentListSchema = z.looseObject({
  msg: z.string(),
  company_name: z.string().nullish(),
  token_status: z.string().nullish(),
  companyOfferingAttachmentList: z.array(rawAttachmentSchema),
});

export const rawSessionInfoSchema = z.looseObject({
  msg: z.string(),
  usertype: z.string(),
  name: z.string().nullish(),
});

export type RawCompanyOffering = z.infer<typeof rawCompanyOfferingSchema>;
export type RawOfferingDetails = z.infer<typeof rawOfferingDetailsSchema>;
export type RawAttachment = z.infer<typeof rawAttachmentSchema>;
export type RawSessionInfo = z.infer<typeof rawSessionInfoSchema>;
