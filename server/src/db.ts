import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Job, Lead } from "./types.js";

const dbPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "deal-radar.db");
mkdirSync(dirname(dbPath), { recursive: true });

// Node's built-in SQLite (no native addon to compile or break across Node versions).
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS page_cache (
    url TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    title TEXT,
    text TEXT,
    links TEXT,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS extraction_cache (
    content_hash TEXT PRIMARY KEY,
    extracted_by TEXT NOT NULL,
    profile TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS leads_job ON leads (job_id);
`);

const PAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedPage {
  status: number;
  title: string;
  text: string;
  links: string[];
}

export function getCachedPage(url: string): CachedPage | null {
  const row = db
    .prepare("SELECT status, title, text, links, fetched_at FROM page_cache WHERE url = ?")
    .get(url) as { status: number; title: string; text: string; links: string; fetched_at: number } | undefined;
  if (!row || Date.now() - row.fetched_at > PAGE_TTL_MS) return null;
  return { status: row.status, title: row.title, text: row.text, links: JSON.parse(row.links) };
}

export function setCachedPage(url: string, page: CachedPage) {
  db.prepare(
    "INSERT OR REPLACE INTO page_cache (url, status, title, text, links, fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(url, page.status, page.title, page.text, JSON.stringify(page.links), Date.now());
}

export function getCachedExtraction(hash: string) {
  const row = db
    .prepare("SELECT extracted_by, profile FROM extraction_cache WHERE content_hash = ?")
    .get(hash) as { extracted_by: "claude" | "heuristic"; profile: string } | undefined;
  return row ? { extractedBy: row.extracted_by, profile: JSON.parse(row.profile) } : null;
}

export function setCachedExtraction(hash: string, extractedBy: string, profile: unknown) {
  db.prepare(
    "INSERT OR REPLACE INTO extraction_cache (content_hash, extracted_by, profile, created_at) VALUES (?, ?, ?, ?)",
  ).run(hash, extractedBy, JSON.stringify(profile), Date.now());
}

export function saveJob(job: Job) {
  db.prepare("INSERT OR REPLACE INTO jobs (id, data) VALUES (?, ?)").run(job.id, JSON.stringify(job));
}

export function getJob(id: string): Job | null {
  const row = db.prepare("SELECT data FROM jobs WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function saveLead(lead: Lead) {
  db.prepare("INSERT OR REPLACE INTO leads (id, job_id, data) VALUES (?, ?, ?)").run(
    lead.id,
    lead.jobId,
    JSON.stringify(lead),
  );
}

export function getLead(id: string): Lead | null {
  const row = db.prepare("SELECT data FROM leads WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function getLeads(jobId: string): Lead[] {
  const rows = db.prepare("SELECT data FROM leads WHERE job_id = ? ORDER BY rowid").all(jobId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}
