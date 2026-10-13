import { useEffect, useState } from "react";
import { draftOutreach } from "../api";
import type { Email, Lead, Reason } from "../types";
import { Button, ScoreRing, TierBadge } from "./ui";

interface Props {
  lead: Lead;
  onClose: () => void;
}

export function LeadDrawer({ lead, onClose }: Props) {
  const p = lead.profile!;
  const e = lead.enrichment;
  const [email, setEmail] = useState<Email | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEmail(null);
    setCopied(false);
  }, [lead.id]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft = async () => {
    setDrafting(true);
    try {
      setEmail(await draftOutreach(lead.id));
    } finally {
      setDrafting(false);
    }
  };

  const copy = async () => {
    if (!email) return;
    await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const signals: [string, boolean][] = [
    ["Founder still active", p.founderStillActive],
    ["Family-owned", p.familyOwned],
    ["Successor in place", p.successorVisible],
    ["PE / group owned", p.institutionallyOwned],
    ["Hiring", p.hiring],
  ];

  return (
    <aside className="fixed inset-y-0 right-0 z-20 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
      <header className="flex items-start gap-4 border-b border-slate-200 p-5">
        <ScoreRing score={lead.score!} tier={lead.tier!} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-slate-900">{p.companyName ?? lead.domain}</h2>
            <TierBadge tier={lead.tier!} />
          </div>
          <a
            href={`https://${lead.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-indigo-600 hover:underline"
          >
            {lead.domain}
          </a>
          <p className="mt-1 text-sm text-slate-600">{p.summary}</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Why this score</h3>
            <span className="text-xs text-slate-500">
              Sell likelihood {lead.sellScore}/70 · Thesis fit {lead.fitScore}/30
            </span>
          </div>
          <ul className="space-y-1.5">
            {lead.reasons.map((r, i) => (
              <ReasonRow key={i} reason={r} />
            ))}
          </ul>
        </section>

        <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Fact label="Owner" value={p.ownerName ? `${p.ownerName}${p.ownerTitle ? `, ${p.ownerTitle}` : ""}` : null} />
          <Fact label="Founded" value={p.foundedYear ? `${p.foundedYear} (${new Date().getFullYear() - p.foundedYear} yrs)` : null} />
          <Fact label="Location" value={[p.city, p.state].filter(Boolean).join(", ") || null} />
          <Fact label="Team size" value={p.employeeCount ? `~${p.employeeCount}` : null} />
          <Fact
            label="Email"
            value={
              e?.emails[0]
                ? `${e.emails[0]}${e.emailDomainValid === true ? " ✓ MX" : e.emailDomainValid === false ? " ✗ no mail server" : ""}`
                : null
            }
          />
          <Fact label="Phone" value={e?.phones[0] ?? null} />
        </section>

        <section className="flex flex-wrap gap-1.5">
          {signals.map(([label, on]) => (
            <span
              key={label}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                on ? "bg-indigo-50 text-indigo-700" : "bg-slate-50 text-slate-400 line-through"
              }`}
            >
              {label}
            </span>
          ))}
        </section>

        {p.evidence.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Evidence from their website</h3>
            <ul className="space-y-2">
              {p.evidence.map((q, i) => (
                <li key={i} className="border-l-2 border-slate-200 pl-3 text-sm text-slate-600 italic">
                  “{q}”
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Owner outreach</h3>
            {email && (
              <span className="text-xs text-slate-500">{email.source === "claude" ? "Written by Claude" : "Template"}</span>
            )}
          </div>
          {email ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">Subject: {email.subject}</p>
              <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700">{email.body}</p>
              <div className="mt-4 flex gap-2">
                <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
                <Button variant="ghost" onClick={draft} disabled={drafting}>
                  Regenerate
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" onClick={draft} disabled={drafting} className="w-full">
              {drafting ? "Drafting…" : "Draft succession-angle email"}
            </Button>
          )}
        </section>

        <footer className="border-t border-slate-100 pt-4 text-xs text-slate-400">
          Read {lead.pagesCrawled.length} page{lead.pagesCrawled.length === 1 ? "" : "s"} ·{" "}
          {lead.extractedBy === "claude" ? "Extracted by Claude" : "Extracted by rules (no API key)"}
          {e?.copyrightYear ? ` · Site last updated ${e.copyrightYear}` : ""}
        </footer>
      </div>
    </aside>
  );
}

function ReasonRow({ reason: r }: { reason: Reason }) {
  const styles = {
    positive: "text-emerald-700 bg-emerald-50",
    negative: "text-rose-700 bg-rose-50",
    neutral: "text-slate-500 bg-slate-100",
  }[r.kind];
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className={`mt-px w-9 shrink-0 rounded px-1 py-0.5 text-center text-xs font-semibold tabular-nums ${styles}`}>
        {r.kind === "neutral" ? "·" : `${r.points > 0 ? "+" : ""}${r.points}`}
      </span>
      <span className="text-slate-700">{r.label}</span>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={value ? "text-slate-900" : "text-slate-400"}>{value ?? "Not found"}</div>
    </div>
  );
}
