import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { crawlCompany, normalizeDomain } from "./crawler.js";
import { extractProfile } from "./extract.js";
import { enrich, isSameCompany } from "./enrich.js";
import { scoreLead } from "./score.js";
import { getCachedPage, getJob, getLeads, saveJob, saveLead } from "./db.js";
import type { CompanyInput, Job, Lead, Profile, Thesis } from "./types.js";

const CONCURRENCY = 4;

/** One emitter per running job; the SSE route subscribes to it. */
export const jobEvents = new Map<string, EventEmitter>();

export function createJob(companies: CompanyInput[], thesis: Thesis): Job {
  // Exact de-duplication by normalised domain before we spend any requests.
  const seen = new Map<string, CompanyInput>();
  for (const c of companies) {
    const domain = normalizeDomain(c.domain);
    if (domain && !seen.has(domain)) seen.set(domain, { ...c, domain });
  }
  const unique = [...seen.values()];

  const job: Job = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    thesis,
    total: unique.length,
    completed: 0,
    duplicatesRemoved: companies.length - unique.length,
    status: "running",
  };
  saveJob(job);

  const leads: Lead[] = unique.map((c) => ({
    id: randomUUID(),
    jobId: job.id,
    domain: c.domain,
    inputName: c.name?.trim() || null,
    status: "queued",
    error: null,
    extractedBy: null,
    profile: null,
    enrichment: null,
    score: null,
    sellScore: null,
    fitScore: null,
    tier: null,
    reasons: [],
    duplicateOf: null,
    pagesCrawled: [],
  }));
  leads.forEach(saveLead);

  const emitter = new EventEmitter();
  jobEvents.set(job.id, emitter);
  void runJob(job, leads, unique, emitter);
  return job;
}

async function runJob(job: Job, leads: Lead[], inputs: CompanyInput[], emitter: EventEmitter) {
  const limit = pLimit(CONCURRENCY);
  const update = (lead: Lead) => {
    saveLead(lead);
    emitter.emit("lead", lead);
  };

  await Promise.all(
    leads.map((lead, i) =>
      limit(async () => {
        lead.status = "crawling";
        update(lead);
        try {
          await processLead(lead, inputs[i], job.thesis);
        } catch (err) {
          lead.status = "error";
          lead.error = (err as Error).message || "Unknown error";
        }
        job.completed += 1;
        saveJob(job);
        update(lead);
        emitter.emit("progress", { completed: job.completed, total: job.total });
      }),
    ),
  );

  markFuzzyDuplicates(getLeads(job.id)).forEach(update);
  job.status = "done";
  saveJob(job);
  emitter.emit("done", job);
  setTimeout(() => jobEvents.delete(job.id), 60_000);
}

async function processLead(lead: Lead, input: CompanyInput, thesis: Thesis) {
  const crawl = await crawlCompany(lead.domain);
  if (crawl.blockedByRobots) {
    lead.status = "blocked";
    lead.error = "robots.txt disallows crawling this site";
    return;
  }
  lead.pagesCrawled = crawl.pages.map((p) => p.url);

  const { profile, extractedBy } = await extractProfile(lead.domain, crawl);
  // CSV columns fill gaps the website left.
  profile.companyName ??= input.name ?? null;
  profile.city ??= input.city ?? null;
  profile.state ??= input.state ?? null;
  profile.industry ??= input.industry ?? null;

  const enrichment = await enrich(lead.domain, profile, crawl);
  const haystack = buildHaystack(profile, crawl.pages.map((p) => p.text));

  Object.assign(lead, scoreLead(profile, enrichment, thesis, haystack), {
    status: "done",
    extractedBy,
    profile,
    enrichment,
  });
}

/** Different domains that are clearly the same business: keep the higher-scoring one. */
function markFuzzyDuplicates(leads: Lead[]): Lead[] {
  const changed: Lead[] = [];
  const done = leads.filter((l) => l.status === "done").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (let i = 0; i < done.length; i++) {
    const a = done[i];
    if (a.duplicateOf) continue;
    for (const b of done.slice(i + 1)) {
      const nameA = a.profile?.companyName ?? a.inputName;
      const nameB = b.profile?.companyName ?? b.inputName;
      if (!b.duplicateOf && nameA && nameB && isSameCompany(nameA, nameB)) {
        b.duplicateOf = a.id;
        changed.push(b);
      }
    }
  }
  return changed;
}

/** Text the industry and region matchers search: extracted fields plus the raw page text. */
function buildHaystack(profile: Profile, pageTexts: string[]): string {
  return [profile.industry, profile.summary, profile.services.join(" "), ...pageTexts].join(" ");
}

/**
 * Re-scores a finished job against a new thesis without re-crawling: profiles and enrichment are stored,
 * and page text comes from the page cache. This is what makes the thesis filters feel instant.
 */
export function rescoreJob(jobId: string, thesis: Thesis): { job: Job; leads: Lead[] } | null {
  const job = getJob(jobId);
  if (!job) return null;
  job.thesis = thesis;
  saveJob(job);

  const leads = getLeads(jobId);
  for (const lead of leads) {
    if (lead.status !== "done" || !lead.profile || !lead.enrichment) continue;
    const pageTexts = lead.pagesCrawled.map((url) => getCachedPage(url)?.text ?? "");
    Object.assign(lead, scoreLead(lead.profile, lead.enrichment, thesis, buildHaystack(lead.profile, pageTexts)));
  }
  // Scores changed, so re-decide which copy of a duplicated company to keep (the higher-scoring one).
  leads.forEach((l) => (l.duplicateOf = null));
  markFuzzyDuplicates(leads);
  leads.forEach(saveLead);
  return { job, leads };
}
