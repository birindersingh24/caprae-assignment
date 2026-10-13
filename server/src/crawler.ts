import * as cheerio from "cheerio";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCachedPage, setCachedPage, type CachedPage } from "./db.js";

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
// robots-parser is CommonJS (module.exports = fn) but its typings declare a default export.
const robotsParser = createRequire(import.meta.url)("robots-parser") as (url: string, body: string) => Robots;

const USER_AGENT = "DealRadarBot/0.1 (+https://github.com/; research crawler, respects robots.txt)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SUBPAGES = 3;
const MAX_TEXT_PER_PAGE = 12_000;
const POLITE_DELAY_MS = 400;

/** Pages most likely to mention owners, founding year and team. */
const SUBPAGE_PATTERN = /about|our-story|story|history|team|leadership|owner|who-we-are|contact|company/i;

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

/** `.demo` domains are served from local fixtures so the app can be demoed offline and deterministically. */
export const isDemoDomain = (domain: string) => domain.endsWith(".demo");

export interface CrawlResult {
  pages: { url: string; title: string; text: string }[];
  blockedByRobots: boolean;
}

const robotsCache = new Map<string, Robots | null>();

async function getRobots(domain: string) {
  if (robotsCache.has(domain)) return robotsCache.get(domain) ?? null;
  const url = `https://${domain}/robots.txt`;
  let robots: Robots | null = null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) robots = robotsParser(url, await res.text());
  } catch {
    // No robots.txt reachable: treat as allowed, like most crawlers do.
  }
  robotsCache.set(domain, robots);
  return robots;
}

function parseHtml(html: string, baseUrl: string): Omit<CachedPage, "status"> {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      links.add(new URL(href, baseUrl).toString().split("#")[0]);
    } catch {
      // ignore malformed hrefs
    }
  });
  // Keep mailto/tel targets as text so extraction sees them.
  const contactBits = $("a[href^='mailto:'], a[href^='tel:']")
    .map((_, el) => $(el).attr("href")!.replace(/^(mailto|tel):/, ""))
    .get()
    .join(" ");
  $("script, style, noscript, svg, iframe").remove();
  // .text() glues adjacent blocks together ("AboutFounded in..."), so separate them first.
  $("br").replaceWith("\n");
  $("p, h1, h2, h3, h4, h5, h6, li, div, section, article, header, footer, nav, td, tr, a").append("\n");
  const title = $("title").first().text().trim();
  const meta = $("meta[name='description']").attr("content") ?? "";
  const body = $("body").text();
  const text = [meta, body, contactBits]
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_PER_PAGE);
  return { title, text, links: [...links] };
}

async function fetchPage(url: string, domain: string): Promise<CachedPage> {
  const cached = getCachedPage(url);
  if (cached) return cached;

  let page: CachedPage;
  if (isDemoDomain(domain)) {
    const path = new URL(url).pathname.replace(/^\/|\/$/g, "") || "index";
    const file = join(fixturesDir, domain, `${path}.html`);
    page = existsSync(file)
      ? { status: 200, ...parseHtml(readFileSync(file, "utf8"), url) }
      : { status: 404, title: "", text: "", links: [] };
  } else {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const isHtml = (res.headers.get("content-type") ?? "").includes("text/html");
    page = res.ok && isHtml
      ? { status: res.status, ...parseHtml(await res.text(), res.url) }
      : { status: res.status, title: "", text: "", links: [] };
  }
  setCachedPage(url, page);
  return page;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetches the homepage plus up to 3 about/team/contact pages on the same domain, one request at a time. */
export async function crawlCompany(domain: string): Promise<CrawlResult> {
  const demo = isDemoDomain(domain);
  const robots = demo ? null : await getRobots(domain);
  const allowed = (url: string) => !robots || robots.isAllowed(url, USER_AGENT) !== false;

  const home = `https://${domain}/`;
  if (!allowed(home)) return { pages: [], blockedByRobots: true };

  const homePage = await fetchPage(home, domain);
  if (homePage.status >= 400 || !homePage.text) {
    throw new Error(`Homepage returned ${homePage.status}`);
  }

  const pages = [{ url: home, title: homePage.title, text: homePage.text }];
  const sameSite = (u: string) => normalizeDomain(new URL(u).hostname) === domain;
  const subpages = homePage.links
    .filter((u) => sameSite(u) && u !== home && SUBPAGE_PATTERN.test(new URL(u).pathname))
    .filter(allowed)
    .slice(0, MAX_SUBPAGES);

  for (const url of subpages) {
    if (!demo) await sleep(POLITE_DELAY_MS);
    try {
      const page = await fetchPage(url, domain);
      if (page.status < 400 && page.text) pages.push({ url, title: page.title, text: page.text });
    } catch {
      // A failed subpage shouldn't sink the whole company.
    }
  }
  return { pages, blockedByRobots: false };
}
