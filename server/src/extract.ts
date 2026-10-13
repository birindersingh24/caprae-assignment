import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createHash } from "node:crypto";
import { getCachedExtraction, setCachedExtraction } from "./db.js";
import { ProfileSchema, type Profile } from "./types.js";
import type { CrawlResult } from "./crawler.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const client = claudeEnabled ? new Anthropic() : null;

/** Last Claude API failure (e.g. no credits), surfaced in /api/health so the UI doesn't claim AI is working when it isn't. */
export const claudeStatus: { lastError: string | null } = { lastError: null };

export function recordClaudeError(err: unknown) {
  const e = err as { status?: number; message?: string; error?: { error?: { message?: string } } };
  claudeStatus.lastError = e.error?.error?.message ?? e.message ?? "Unknown Claude API error";
}

const SYSTEM_PROMPT = `You are a research analyst helping an acquisition entrepreneur (a "searcher") evaluate small, privately held businesses they might buy.

You will receive text scraped from one company's website. Extract facts into the requested schema.

Rules:
- Only use what the website text states or clearly implies. If something isn't there, use null, false or an empty list. Never guess an owner's name, founding year or headcount.
- foundedYear: prefer explicit "founded/established/since" statements over copyright years.
- founderStillActive: true only when the founder or original owner is described as currently running the company.
- successorVisible: true when a son/daughter, "second generation", a newly appointed president/CEO, or a named successor is running or taking over.
- institutionallyOwned: true when the site says the company is part of a larger group, was acquired, or is backed by private equity.
- evidence: short verbatim quotes (under 25 words each) that justify the owner, founding and succession fields.`;

const hashPages = (crawl: CrawlResult) =>
  createHash("sha256")
    .update(crawl.pages.map((p) => p.text).join("\n---\n"))
    .digest("hex");

export async function extractProfile(
  domain: string,
  crawl: CrawlResult,
): Promise<{ profile: Profile; extractedBy: "claude" | "heuristic" }> {
  const hash = hashPages(crawl);
  const cached = getCachedExtraction(hash);
  if (cached && (cached.extractedBy === "claude" || !claudeEnabled)) return cached;

  let result: { profile: Profile; extractedBy: "claude" | "heuristic" };
  try {
    result = client
      ? { profile: await extractWithClaude(domain, crawl), extractedBy: "claude" }
      : { profile: extractWithHeuristics(crawl), extractedBy: "heuristic" };
    if (client) claudeStatus.lastError = null;
  } catch (err) {
    recordClaudeError(err);
    console.warn(`[extract] Claude extraction failed for ${domain}, using heuristics:`, (err as Error).message);
    result = { profile: extractWithHeuristics(crawl), extractedBy: "heuristic" };
  }
  setCachedExtraction(hash, result.extractedBy, result.profile);
  return result;
}

async function extractWithClaude(domain: string, crawl: CrawlResult): Promise<Profile> {
  const pagesXml = crawl.pages
    .map((p) => `<page url="${p.url}" title="${p.title.replace(/"/g, "'")}">\n${p.text}\n</page>`)
    .join("\n");

  const response = await client!.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ProfileSchema) },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `<website domain="${domain}">\n${pagesXml}\n</website>\n\nExtract the company profile.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  if (!response.parsed_output) throw new Error(`No structured output (stop_reason: ${response.stop_reason})`);
  return response.parsed_output;
}

// ---------------------------------------------------------------------------
// Heuristic fallback: regexes over the scraped text. Less accurate than Claude,
// but keeps the tool usable with no API key and as a safety net on API errors.
// ---------------------------------------------------------------------------

// Case-sensitive on purpose: names must be capitalised ("Ray Dawson", not "over as").
const NAME = "([A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-zA-Z'-]+)";
const OWNER_TITLES = "[Oo]wner|[Ff]ounder|[Pp]resident|CEO|[Pp]rincipal";

export function extractWithHeuristics(crawl: CrawlResult): Profile {
  const text = crawl.pages.map((p) => p.text).join("\n");
  const evidence: string[] = [];
  const quote = (m: RegExpMatchArray | null) => {
    if (m && evidence.length < 5) evidence.push(m[0].trim().slice(0, 160));
    return m;
  };

  const founded = quote(text.match(/\b(?:founded|established|since|started|est\.)\s*(?:in\s*)?((?:19|20)\d{2})\b/i));
  const foundedYear = founded ? Number(founded[1]) : null;

  const ownerAfter = text.match(new RegExp(`${NAME},?\\s*(?:—|-|–|,)?\\s*(?:the\\s+)?(?:co-)?(${OWNER_TITLES})\\b`));
  const ownerBefore = text.match(new RegExp(`\\b(?:co-)?(${OWNER_TITLES})[,:]?\\s+${NAME}`));
  let ownerName: string | null = null;
  let ownerTitle: string | null = null;
  if (ownerAfter) {
    quote(ownerAfter);
    ownerName = ownerAfter[1];
    ownerTitle = ownerAfter[2];
  } else if (ownerBefore) {
    quote(ownerBefore);
    ownerTitle = ownerBefore[1];
    ownerName = ownerBefore[2];
  }

  const successor = quote(
    text.match(
      /(second|third|next)[- ]generation[^.\n]*|(?:son|daughter|nephew|niece)[^.\n]{0,60}(?:joined|took over|now runs|president|ceo)[^.\n]*|(?:named|appointed)[^.\n]{0,40}(?:president|ceo)[^.\n]*/i,
    ),
  );
  const institutional = quote(
    text.match(/(?:acquired by|a portfolio company of|part of the [A-Z][\w ]+ (?:family|group)|backed by [\w ]*(?:capital|partners|equity))[^.\n]*/i),
  );
  const family = /family[- ]owned|family business|family-run/i.test(text);
  const founderActive =
    /founder[^.\n]{0,60}(?:still|continues|personally|today)|(?:still|continues to)[^.\n]{0,40}(?:run|lead|manage|answer)/i.test(text) ||
    (ownerTitle !== null && /founder|owner/i.test(ownerTitle) && !successor);

  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])].slice(0, 5);
  const phones = [...new Set(text.match(/(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [])].slice(0, 3);
  const team = text.match(/\b(?:team of|staff of|crew of)\s+(\d{1,4})\b|\b(\d{1,4})\s+(?:employees|team members|technicians)\b/i);
  const location = text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2}),\s*([A-Z]{2})\s+\d{5}\b/);
  const city = location?.[1].replace(/^(?:Serving|Located in|Based in)\s+/, "") ?? null;

  const home = crawl.pages[0];
  const metaSummary = home?.text.split("\n")[0]?.slice(0, 200) ?? "";

  return {
    companyName: home?.title.split(/[|\-–]/)[0].trim() || null,
    summary: metaSummary,
    industry: null,
    services: [],
    city,
    state: location?.[2] ?? null,
    foundedYear,
    ownerName,
    ownerTitle,
    founderStillActive: founderActive,
    familyOwned: family,
    successorVisible: Boolean(successor),
    institutionallyOwned: Boolean(institutional),
    hiring: /now hiring|we'?re hiring|join our team|careers/i.test(text),
    employeeCount: team ? Number(team[1] ?? team[2]) : null,
    emails,
    phones,
    evidence,
  };
}
