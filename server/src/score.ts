import type { Enrichment, Lead, Profile, Reason, Thesis } from "./types.js";

/**
 * Two scores, both explainable:
 *  - sellScore (0-70): how likely the owner is to sell in the next few years.
 *  - fitScore  (0-30): how well the company matches the searcher's thesis.
 * Every point comes with a reason so a user can see *why* a lead ranks where it does.
 */
export function scoreLead(
  profile: Profile,
  enrichment: Enrichment,
  thesis: Thesis,
  haystack: string,
): Pick<Lead, "score" | "sellScore" | "fitScore" | "tier" | "reasons"> {
  const sell: Reason[] = [];
  const fit: Reason[] = [];
  const year = new Date().getFullYear();

  // --- Sell likelihood ------------------------------------------------------
  if (profile.foundedYear) {
    const age = year - profile.foundedYear;
    if (age >= 30) sell.push(pos(`In business ${age} years (since ${profile.foundedYear}), owner likely near retirement`, 20));
    else if (age >= 20) sell.push(pos(`In business ${age} years (since ${profile.foundedYear})`, 15));
    else if (age >= 10) sell.push(pos(`In business ${age} years, established operations`, 8));
    else sell.push(neg(`Only ${age} years old, owner is less likely to be planning an exit`, 0));
    if (age < thesis.minYearsInBusiness) fit.push(neg(`Below your ${thesis.minYearsInBusiness}-year minimum`, -10));
  } else {
    sell.push(neutral("Founding year not found on website"));
  }

  if (profile.institutionallyOwned) {
    sell.push(neg("Already part of a larger group or PE-backed, so not a founder sale", -25));
  } else {
    if (profile.founderStillActive) {
      sell.push(pos(`Founder still runs the business${profile.ownerName ? ` (${profile.ownerName})` : ""}`, 15));
    }
    if (profile.successorVisible) {
      sell.push(neg("Next generation or successor already in place", -10));
    } else if (profile.founderStillActive) {
      sell.push(pos("No successor mentioned on the website", 10));
    }
    if (profile.familyOwned) sell.push(pos("Family-owned", 5));
  }

  if (enrichment.copyrightYear && year - enrichment.copyrightYear >= 4) {
    sell.push(pos(`Website not updated since ${enrichment.copyrightYear}, possible under-investment`, 5));
  }

  if (profile.employeeCount) {
    if (profile.employeeCount <= 100) sell.push(pos(`About ${profile.employeeCount} employees, a searcher-sized deal`, 5));
    else if (profile.employeeCount > 250) sell.push(neg(`${profile.employeeCount}+ employees, likely too large for a search fund`, -5));
  }

  if (profile.hiring) sell.push(neutral("Actively hiring (healthy demand)"));

  // --- Thesis fit -----------------------------------------------------------
  const text = haystack.toLowerCase();
  let industryMismatch = false;
  if (thesis.industries.length) {
    const hit = thesis.industries.find((i) => matchesIndustry(i, text));
    if (hit) fit.push(pos(`Matches target industry "${hit}"`, 15));
    else {
      industryMismatch = true;
      fit.push(neg(`Not in your target industries (${thesis.industries.join(", ")})`, -10));
    }
  }

  if (thesis.regions.length) {
    const location = [profile.city, profile.state].filter(Boolean).join(", ");
    const hit = thesis.regions.find((r) => {
      const region = r.toLowerCase().trim();
      const code = region.length === 2 ? region : STATE_CODES[region];
      return code
        ? profile.state?.toLowerCase() === code || STATE_CODES[profile.state?.toLowerCase() ?? ""] === code
        : location.toLowerCase().includes(region) || text.includes(region);
    });
    if (hit) fit.push(pos(`Located in target region (${location || hit})`, 10));
    else fit.push(neg(location ? `Located in ${location}, outside your regions` : "Location not found", location ? -5 : 0));
  }

  if (enrichment.emails.length && enrichment.emailDomainValid !== false) {
    fit.push(pos(`Contactable: ${enrichment.emails[0]}${enrichment.emailDomainValid ? " (mail server verified)" : ""}`, 5));
  } else if (enrichment.phones.length) {
    fit.push(pos(`Contactable by phone: ${enrichment.phones[0]}`, 3));
  } else {
    fit.push(neg("No email or phone found", 0));
  }

  const sellScore = clamp(sum(sell), 0, 70);
  const fitScore = clamp(sum(fit), 0, 30);
  let score = clamp(sellScore + fitScore, 0, 100);
  // The searcher's industry is a hard preference: a great owner in the wrong industry is still not a lead.
  if (industryMismatch && score > INDUSTRY_MISMATCH_CAP) {
    // Recorded as real points so the reasons still add up to the score and this shows as the deciding factor.
    fit.push(neg(`Capped at ${INDUSTRY_MISMATCH_CAP}: outside your target industries`, INDUSTRY_MISMATCH_CAP - score));
    score = INDUSTRY_MISMATCH_CAP;
  }
  const tier = score >= 65 ? "hot" : score >= 40 ? "warm" : "cold";
  return { score, sellScore, fitScore, tier, reasons: [...sell, ...fit] };
}

const INDUSTRY_MISMATCH_CAP = 30;

/** What a business in each industry tends to call itself, so "cars" also finds "auto repair" or "dealership". */
const INDUSTRY_SYNONYMS: Record<string, string[]> = {
  car: ["car", "auto", "automotive", "automobile", "vehicle", "dealership", "dealer", "auto repair", "collision", "body shop", "mechanic", "tire", "car wash"],
  hvac: ["hvac", "heating", "air conditioning", "furnace", "ac repair", "cooling"],
  plumbing: ["plumbing", "plumber", "drain", "water heater", "sewer"],
  electric: ["electric", "electrical", "electrician", "wiring"],
  roofing: ["roofing", "roofer", "roof"],
  landscaping: ["landscaping", "landscape", "lawn", "yard", "irrigation"],
  "pest control": ["pest", "termite", "exterminator", "rodent"],
  construction: ["construction", "contractor", "builder", "remodel"],
  dental: ["dental", "dentist", "orthodont"],
  accounting: ["accounting", "accountant", "bookkeeping", "cpa", "tax preparation"],
};

const ALIASES: Record<string, string> = {
  cars: "car", auto: "car", automotive: "car", vehicles: "car",
  electrical: "electric", electrician: "electric", plumber: "plumbing", roofer: "roofing",
  landscape: "landscaping", pest: "pest control", dentist: "dental",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match (with optional plural) against the term and its synonyms. */
export function matchesIndustry(term: string, text: string): boolean {
  const key = term.toLowerCase().trim().replace(/s$/, "");
  const canonical = ALIASES[term.toLowerCase().trim()] ?? ALIASES[key] ?? key;
  const words = INDUSTRY_SYNONYMS[canonical] ?? [canonical];
  return words.some((w) => new RegExp(`\\b${escapeRe(w)}(?:s|es)?\\b`, "i").test(text));
}

const STATE_CODES: Record<string, string> = Object.fromEntries(
  Object.entries({
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
    de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
    ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan",
    mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
    nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
    ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
    tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
    wi: "wisconsin", wy: "wyoming",
  }).map(([code, name]) => [name, code]),
);

const pos = (label: string, points: number): Reason => ({ kind: "positive", label, points });
const neg = (label: string, points: number): Reason => ({ kind: "negative", label, points });
const neutral = (label: string): Reason => ({ kind: "neutral", label, points: 0 });
const sum = (rs: Reason[]) => rs.reduce((t, r) => t + r.points, 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
