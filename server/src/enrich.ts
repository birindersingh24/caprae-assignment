import { resolveMx } from "node:dns/promises";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { distance } from "fastest-levenshtein";
import { isDemoDomain } from "./crawler.js";
import type { CrawlResult } from "./crawler.js";
import type { Enrichment, Profile } from "./types.js";

const mxCache = new Map<string, boolean | null>();

/** Does the domain accept email at all? `null` means we couldn't tell (demo domain or DNS failure). */
async function hasMx(domain: string): Promise<boolean | null> {
  if (isDemoDomain(domain)) return null;
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let result: boolean | null;
  try {
    result = (await resolveMx(domain)).length > 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    result = code === "ENOTFOUND" || code === "ENODATA" ? false : null;
  }
  mxCache.set(domain, result);
  return result;
}

const EMAIL_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
const JUNK_EMAIL = /example\.|sentry|wixpress|\.(png|jpe?g|gif|webp)$/i;

export async function enrich(domain: string, profile: Profile, crawl: CrawlResult): Promise<Enrichment> {
  const emails = [...new Set(profile.emails.map((e) => e.toLowerCase().trim()))].filter(
    (e) => EMAIL_RE.test(e) && !JUNK_EMAIL.test(e),
  );

  const phones = [
    ...new Set(
      profile.phones
        .map((p) => parsePhoneNumberFromString(p, "US"))
        .filter((p) => p?.isValid())
        .map((p) => p!.formatNational()),
    ),
  ];

  const footerText = crawl.pages.map((p) => p.text).join("\n");
  const years = [...footerText.matchAll(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  const copyrightYear = years.length ? Math.max(...years) : null;

  return { emailDomainValid: await hasMx(domain), emails, phones, copyrightYear };
}

const LEGAL_SUFFIX = /\b(inc|llc|ltd|co|corp|company|corporation|group|the)\b\.?/g;

export const normalizeName = (name: string) =>
  name.toLowerCase().replace(LEGAL_SUFFIX, "").replace(/[^a-z0-9]/g, "");

/** Two different domains, same business (e.g. a rebrand or a second site)? */
export function isSameCompany(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length < 4 || y.length < 4) return false;
  return distance(x, y) / Math.max(x.length, y.length) <= 0.15;
}
