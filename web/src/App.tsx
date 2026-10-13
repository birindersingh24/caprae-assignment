import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createJob, exportUrl, getHealth, rescoreJob, streamJob, type Health } from "./api";
import type { CompanyInput, Job, Lead, Thesis } from "./types";
import { SetupPanel } from "./components/SetupPanel";
import { LeadsTable } from "./components/LeadsTable";
import { LeadDrawer } from "./components/LeadDrawer";
import { Card } from "./components/ui";

export default function App() {
  const [mode, setMode] = useState<Health | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("lead"),
  );

  // Keep ?job=…&lead=… in the URL so a refresh or a shared link reopens the same view.
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("lead", id);
    else params.delete("lead");
    window.history.replaceState(null, "", `?${params}`);
  }, []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setMode).catch(() => setError("Can't reach the API. Is the server running on :4000?"));
  }, []);

  const subscribe = useCallback((jobId: string) => {
    return streamJob(jobId, {
      onSnapshot: ({ job, leads }) => {
        setJob(job);
        setLeads(leads);
      },
      onLead: (lead) => setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l))),
      onProgress: ({ completed }) => setJob((j) => (j ? { ...j, completed } : j)),
      onDone: (job) => {
        setJob(job);
        getHealth().then(setMode).catch(() => {});
      },
    });
  }, []);

  // Restore the last job from the URL so a refresh (or a shared link) keeps the results.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (id) return subscribe(id);
  }, [subscribe]);

  const run = async (companies: CompanyInput[], thesis: Thesis) => {
    setError(null);
    setSelectedId(null);
    try {
      const created = await createJob(companies, thesis);
      window.history.replaceState(null, "", `?job=${created.id}`);
      setJob(created);
      setLeads([]);
      subscribe(created.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Live re-ranking: when the thesis changes on a finished job, re-score on the server (no re-crawl).
  const [rescoring, setRescoring] = useState(false);
  const rescoreTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const jobRef = useRef(job);
  jobRef.current = job;

  const onThesisChange = useCallback((thesis: Thesis) => {
    clearTimeout(rescoreTimer.current);
    const current = jobRef.current;
    if (!current || current.status !== "done" || JSON.stringify(current.thesis) === JSON.stringify(thesis)) return;
    rescoreTimer.current = setTimeout(async () => {
      setRescoring(true);
      try {
        const result = await rescoreJob(current.id, thesis);
        setJob(result.job);
        setLeads(result.leads);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setRescoring(false);
      }
    }, 400);
  }, []);

  const selected = leads.find((l) => l.id === selectedId) ?? null;
  const running = job?.status === "running";

  const stats = useMemo(() => {
    const live = leads.filter((l) => !l.duplicateOf && l.status === "done");
    const hot = live.filter((l) => l.tier === "hot").length;
    return {
      analysed: live.length,
      hot,
      warm: live.filter((l) => l.tier === "warm").length,
      dupes: (job?.duplicatesRemoved ?? 0) + leads.filter((l) => l.duplicateOf).length,
      skippable: live.length - hot,
    };
  }, [leads, job]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="size-8" />
            <div>
              <h1 className="text-base leading-tight font-semibold text-slate-900">Deal Radar</h1>
              <p className="text-xs text-slate-500">Find the owners who are ready to sell, before you spend a credit</p>
            </div>
          </div>
          {mode && <ModeBadge health={mode} />}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <SetupPanel
          running={running}
          hasResults={job?.status === "done"}
          onRun={run}
          onThesisChange={onThesisChange}
          jobThesis={job ? { jobId: job.id, thesis: job.thesis } : null}
        />

        {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

        {job && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Analysed" value={`${stats.analysed}`} sub={running ? `${job.completed}/${job.total} sites read` : "complete"} />
              <Stat label="Hot leads" value={`${stats.hot}`} sub="contact first" accent="text-rose-600" />
              <Stat label="Warm leads" value={`${stats.warm}`} sub="nurture" accent="text-amber-600" />
              <Stat label="Duplicates removed" value={`${stats.dupes}`} sub="same company, merged" />
              <Stat label="Enrichment credits saved" value={`${stats.skippable}`} sub="skip non-hot leads" accent="text-indigo-600" />
            </div>

            {running && (
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${(job.completed / Math.max(job.total, 1)) * 100}%` }}
                />
              </div>
            )}

            <Card>
              <div className="flex items-center justify-between px-4 pt-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Ranked leads</h2>
                  <p className="text-xs text-slate-500">
                    {rescoring
                      ? "Re-ranking…"
                      : `Scored for: ${job.thesis.industries.join(", ") || "any industry"} · ${
                          job.thesis.regions.join(", ") || "any region"
                        } · ${job.thesis.minYearsInBusiness}+ yrs`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={exportUrl(job.id, "standard")}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
                  >
                    Export CSV
                  </a>
                  <a
                    href={exportUrl(job.id, "hubspot")}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Export for HubSpot
                  </a>
                </div>
              </div>
              <LeadsTable leads={leads} selectedId={selectedId} onSelect={(l) => setSelectedId(l.id)} />
            </Card>
          </>
        )}

        {!job && <EmptyState />}
      </main>

      {selected?.profile && (
        <>
          <div className="fixed inset-0 z-10 bg-slate-900/20" onClick={() => setSelectedId(null)} />
          <LeadDrawer lead={selected} onClose={() => setSelectedId(null)} />
        </>
      )}
    </div>
  );
}

function ModeBadge({ health }: { health: Health }) {
  const failing = health.mode === "claude" && health.claudeError;
  const [label, style, title] =
    health.mode === "heuristic"
      ? ["Rules-only mode", "bg-amber-50 text-amber-700", "Set ANTHROPIC_API_KEY for AI extraction"]
      : failing
        ? ["AI unavailable, using rules", "bg-rose-50 text-rose-700", `Claude API error: ${health.claudeError}`]
        : ["AI extraction on", "bg-emerald-50 text-emerald-700", `Extraction by ${health.model}`];
  return (
    <span className={`max-w-xs truncate rounded-full px-2.5 py-1 text-xs font-medium ${style}`} title={title}>
      {label}
    </span>
  );
}

function Stat({ label, value, sub, accent = "text-slate-900" }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </Card>
  );
}

function EmptyState() {
  const steps = [
    ["Read", "We visit each company's homepage, About and Contact pages, respecting robots.txt."],
    ["Extract", "Owner, founding year, team size, succession and family-ownership signals, with quotes as evidence."],
    ["Score", "0–100: how likely the owner is to sell (70) plus how well it fits your thesis (30). Every point is explained."],
    ["Act", "Draft a respectful succession-angle email, or export the ranked list to CSV / HubSpot."],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {steps.map(([title, body], i) => (
        <Card key={title} className="p-4">
          <div className="text-xs font-semibold text-indigo-600">Step {i + 1}</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
          <p className="mt-1 text-sm text-slate-600">{body}</p>
        </Card>
      ))}
    </div>
  );
}
