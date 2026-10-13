// Mirrors server/src/types.ts (response shapes only).

export interface CompanyInput {
  domain: string;
  name?: string;
  city?: string;
  state?: string;
  industry?: string;
}

export interface Thesis {
  industries: string[];
  regions: string[];
  minYearsInBusiness: number;
}

export interface Profile {
  companyName: string | null;
  summary: string;
  industry: string | null;
  services: string[];
  city: string | null;
  state: string | null;
  foundedYear: number | null;
  ownerName: string | null;
  ownerTitle: string | null;
  founderStillActive: boolean;
  familyOwned: boolean;
  successorVisible: boolean;
  institutionallyOwned: boolean;
  hiring: boolean;
  employeeCount: number | null;
  emails: string[];
  phones: string[];
  evidence: string[];
}

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

export type Tier = "hot" | "warm" | "cold";

export interface Lead {
  id: string;
  jobId: string;
  domain: string;
  inputName: string | null;
  status: "queued" | "crawling" | "done" | "error" | "blocked";
  error: string | null;
  extractedBy: "claude" | "heuristic" | null;
  profile: Profile | null;
  enrichment: Enrichment | null;
  score: number | null;
  sellScore: number | null;
  fitScore: number | null;
  tier: Tier | null;
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

export interface Email {
  subject: string;
  body: string;
  source: "claude" | "template";
}
