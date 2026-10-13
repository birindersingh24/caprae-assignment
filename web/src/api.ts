import type { CompanyInput, Email, Job, Lead, Thesis } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export interface Health {
  mode: "claude" | "heuristic";
  model: string | null;
  claudeError: string | null;
}

export const getHealth = () => request<Health>("/api/health");

export const createJob = (companies: CompanyInput[], thesis: Thesis) =>
  request<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ companies, thesis }) });

export const rescoreJob = (jobId: string, thesis: Thesis) =>
  request<{ job: Job; leads: Lead[] }>(`/api/jobs/${jobId}/rescore`, { method: "POST", body: JSON.stringify(thesis) });

export const draftOutreach = (leadId: string) =>
  request<Email>(`/api/leads/${leadId}/outreach`, { method: "POST" });

export const exportUrl = (jobId: string, format: "standard" | "hubspot") =>
  `${BASE}/api/jobs/${jobId}/export.csv?format=${format}`;

interface StreamHandlers {
  onSnapshot: (data: { job: Job; leads: Lead[] }) => void;
  onLead: (lead: Lead) => void;
  onProgress: (p: { completed: number; total: number }) => void;
  onDone: (job: Job) => void;
}

/** Subscribes to live job updates over Server-Sent Events. Returns an unsubscribe function. */
export function streamJob(jobId: string, h: StreamHandlers): () => void {
  const es = new EventSource(`${BASE}/api/jobs/${jobId}/stream`);
  es.addEventListener("snapshot", (e) => h.onSnapshot(JSON.parse(e.data)));
  es.addEventListener("lead", (e) => h.onLead(JSON.parse(e.data)));
  es.addEventListener("progress", (e) => h.onProgress(JSON.parse(e.data)));
  es.addEventListener("done", (e) => {
    h.onDone(JSON.parse(e.data));
    es.close();
  });
  return () => es.close();
}
