import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import type { CompanyInput, Thesis } from "../types";
import { Button, Card } from "./ui";

interface Props {
  running: boolean;
  hasResults: boolean;
  onRun: (companies: CompanyInput[], thesis: Thesis) => void;
  /** Fires whenever the thesis fields change, so existing results can be re-scored live. */
  onThesisChange: (thesis: Thesis) => void;
  /** Thesis of the job on screen (e.g. restored from the URL); the form syncs to it when the job changes. */
  jobThesis: { jobId: string; thesis: Thesis } | null;
}

const COLUMN_ALIASES: Record<keyof CompanyInput, string[]> = {
  domain: ["domain", "website", "url", "site", "company domain name", "company website"],
  name: ["name", "company", "company name", "business name"],
  city: ["city"],
  state: ["state", "state/region", "region"],
  industry: ["industry", "category"],
};

/** Accepts SaaSquatch / Apollo / HubSpot-style exports by matching common column names. */
function rowsToCompanies(rows: Record<string, string>[]): CompanyInput[] {
  return rows
    .map((row) => {
      const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v?.trim()]));
      const pick = (key: keyof CompanyInput) => COLUMN_ALIASES[key].map((a) => lower[a]).find(Boolean);
      return {
        domain: pick("domain") ?? "",
        name: pick("name"),
        city: pick("city"),
        state: pick("state"),
        industry: pick("industry"),
      };
    })
    .filter((c) => c.domain);
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function SetupPanel({ running, hasResults, onRun, onThesisChange, jobThesis }: Props) {
  const [industries, setIndustries] = useState("hvac, plumbing, pest control, electric, roofing");
  const [regions, setRegions] = useState("TX");
  const [minYears, setMinYears] = useState(10);
  const [pasted, setPasted] = useState("");
  const [fileCompanies, setFileCompanies] = useState<CompanyInput[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const syncedJobId = jobThesis?.jobId;
  useEffect(() => {
    if (!jobThesis) return;
    setIndustries(jobThesis.thesis.industries.join(", "));
    setRegions(jobThesis.thesis.regions.join(", "));
    setMinYears(jobThesis.thesis.minYearsInBusiness);
    // Only when a different job is loaded, not on every rescore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedJobId]);

  const thesis: Thesis = { industries: splitList(industries), regions: splitList(regions), minYearsInBusiness: minYears };
  const thesisKey = JSON.stringify(thesis);
  useEffect(() => {
    onThesisChange(JSON.parse(thesisKey));
  }, [thesisKey, onThesisChange]);

  const pastedCompanies: CompanyInput[] = pasted
    .split(/[\n,]/)
    .map((d) => d.trim())
    .filter((d) => d.includes("."))
    .map((domain) => ({ domain }));
  const companies = fileCompanies ?? pastedCompanies;

  const loadCsvText = (text: string, name: string) => {
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const rows = rowsToCompanies(parsed.data);
    if (!rows.length) {
      setError(`No domain/website column found in ${name}.`);
      return;
    }
    setError(null);
    setFileName(name);
    setFileCompanies(rows);
  };

  const loadFile = async (file: File) => loadCsvText(await file.text(), file.name);

  const loadDemo = async () => {
    const res = await fetch("/demo-companies.csv");
    loadCsvText(await res.text(), "demo-companies.csv");
  };

  const run = () => {
    if (!companies.length) {
      setError("Add at least one company domain.");
      return;
    }
    onRun(companies.slice(0, 200), thesis);
  };

  return (
    <Card className="p-5">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Thesis */}
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">1. Your acquisition thesis</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {hasResults
                ? "Change these and the results below re-rank instantly."
                : "Used to score fit. Comma-separated keywords."}
            </p>
          </div>
          <Field label="Target industries">
            <input className={inputCls} value={industries} onChange={(e) => setIndustries(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Regions (state codes or cities)">
              <input className={inputCls} value={regions} onChange={(e) => setRegions(e.target.value)} />
            </Field>
            <Field label="Min. years in business">
              <input
                type="number"
                min={0}
                className={inputCls}
                value={minYears}
                onChange={(e) => setMinYears(Number(e.target.value) || 0)}
              />
            </Field>
          </div>
        </div>

        {/* Companies */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">2. Companies to analyse</h2>
              <p className="mt-0.5 text-xs text-slate-500">Drop a SaaSquatch / Apollo CSV export, or paste domains.</p>
            </div>
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={loadDemo}>
              Load demo list
            </Button>
          </div>

          {fileCompanies ? (
            <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium text-indigo-900">{fileName}</span>
                <span className="text-indigo-700"> · {fileCompanies.length} companies</span>
              </div>
              <button
                className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                onClick={() => {
                  setFileCompanies(null);
                  setFileName(null);
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void loadFile(f);
                }}
                className={`flex h-28 flex-col items-center justify-center rounded-lg border-2 border-dashed text-sm transition ${
                  dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <span className="font-medium text-slate-700">Upload CSV</span>
                <span className="text-xs text-slate-500">drag & drop or click</span>
              </button>
              <textarea
                className={`${inputCls} h-28 resize-none font-mono text-xs`}
                placeholder={"acmehvac.com\nsmithplumbing.com"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
              />
            </div>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              We only read public pages and respect robots.txt. Cached for 7 days.
            </p>
            <Button variant="primary" onClick={run} disabled={running || !companies.length}>
              {running ? "Analysing…" : `Analyse ${companies.length || ""} companies`}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

const inputCls =
  "w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
