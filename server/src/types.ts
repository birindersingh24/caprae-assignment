import { z } from "zod";

export const CompanyInputSchema = z.object({
  domain: z.string().min(3),
  name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  industry: z.string().optional(),
});
export type CompanyInput = z.infer<typeof CompanyInputSchema>;

export const ThesisSchema = z.object({
  industries: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  minYearsInBusiness: z.number().int().min(0).default(10),
});
export type Thesis = z.infer<typeof ThesisSchema>;

export const CreateJobSchema = z.object({
  companies: z.array(CompanyInputSchema).min(1).max(200),
  thesis: ThesisSchema,
});

/** What we pull out of a company's website, either by Claude or by regex heuristics. */
export const ProfileSchema = z.object({
  companyName: z.string().nullable(),
  summary: z.string().describe("One sentence on what the business does."),
  industry: z.string().nullable(),
  services: z.array(z.string()),
  city: z.string().nullable(),
  state: z.string().nullable().describe("US state as 2-letter code when in the US."),
  foundedYear: z.number().int().nullable(),
  ownerName: z.string().nullable().describe("Current owner, founder or president, if named."),
  ownerTitle: z.string().nullable(),
  founderStillActive: z
    .boolean()
    .describe("True if the founder or original owner is still described as running the business."),
  familyOwned: z.boolean(),
  successorVisible: z
    .boolean()
    .describe("True if a next-generation leader, successor or new CEO is named or described."),
  institutionallyOwned: z
    .boolean()
    .describe("True if the company says it was acquired by, or is part of, a PE firm or larger group."),
  hiring: z.boolean(),
  employeeCount: z.number().int().nullable().describe("Only if the site states a team size."),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  evidence: z
    .array(z.string())
    .describe("Up to 5 short verbatim quotes from the site that support the fields above."),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface Reason {
  kind: "positive" | "negative" | "neutral";
  label: string;
  points: number;
}

export interface Enrichment {
  emailDomainValid: boolean | null;
  emails: string[];
  phones: string[];
  copyrightYear: number | null;
}

export type LeadStatus = "queued" | "crawling" | "done" | "error" | "blocked";

export interface Lead {
  id: string;
  jobId: string;
  domain: string;
  inputName: string | null;
  status: LeadStatus;
  error: string | null;
  extractedBy: "claude" | "heuristic" | null;
  profile: Profile | null;
  enrichment: Enrichment | null;
  score: number | null;
  sellScore: number | null;
  fitScore: number | null;
  tier: "hot" | "warm" | "cold" | null;
  reasons: Reason[];
  duplicateOf: string | null;
  pagesCrawled: string[];
}

export interface Job {
  id: string;
  createdAt: string;
  thesis: Thesis;
  total: number;
  completed: number;
  duplicatesRemoved: number;
  status: "running" | "done";
}
