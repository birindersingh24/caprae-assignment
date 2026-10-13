import { useMemo, useState } from "react";
import type { Lead, Tier } from "../types";
import { ScoreRing, TierBadge } from "./ui";

type Filter = "all" | Tier;
type SortKey = "score" | "founded" | "name";

interface Props {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
}

const companyName = (l: Lead) => l.profile?.companyName ?? l.inputName ?? l.domain;

export function LeadsTable({ leads, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [showDupes, setShowDupes] = useState(false);

  const counts = useMemo(() => {
    const c = { all: 0, hot: 0, warm: 0, cold: 0 };
    for (const l of leads) {
      if (l.duplicateOf) continue;
      c.all++;
      if (l.tier) c[l.tier]++;
    }
    return c;
  }, [leads]);

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    return leads
      .filter((l) => showDupes || !l.duplicateOf)
      .filter((l) => filter === "all" || l.tier === filter)
      .filter((l) => !q || `${companyName(l)} ${l.domain} ${l.profile?.ownerName ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === "name") return companyName(a).localeCompare(companyName(b));
        if (sort === "founded") return (a.profile?.foundedYear ?? 9999) - (b.profile?.foundedYear ?? 9999);
        return (b.score ?? -1) - (a.score ?? -1);
      });
  }, [leads, filter, query, sort, showDupes]);

  const dupeCount = leads.filter((l) => l.duplicateOf).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(["all", "hot", "warm", "cold"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {f} <span className="text-slate-400">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, domain, owner…"
          className="min-w-48 flex-1 rounded-lg border-0 px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border-0 py-1.5 pr-8 pl-3 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500"
        >
          <option value="score">Sort: Score</option>
          <option value="founded">Sort: Oldest first</option>
          <option value="name">Sort: Name</option>
        </select>
        {dupeCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={showDupes} onChange={(e) => setShowDupes(e.target.checked)} />
            Show {dupeCount} duplicate{dupeCount > 1 ? "s" : ""}
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="py-2.5 pr-2 pl-4">Score</th>
              <th className="px-3 py-2.5">Company</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Founded</th>
              <th className="px-3 py-2.5">Location</th>
              <th className="px-3 py-2.5">Top signal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((l) => (
              <Row key={l.id} lead={l} selected={l.id === selectedId} onClick={() => onSelect(l)} />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  No leads match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ lead: l, selected, onClick }: { lead: Lead; selected: boolean; onClick: () => void }) {
  const p = l.profile;
  // The single reason that moved the score most, good or bad.
  const topReason = [...l.reasons].filter((r) => r.kind !== "neutral").sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0];
  const age = p?.foundedYear ? new Date().getFullYear() - p.foundedYear : null;

  return (
    <tr
      onClick={l.status === "done" ? onClick : undefined}
      className={`transition ${l.status === "done" ? "cursor-pointer hover:bg-slate-50" : ""} ${
        selected ? "bg-indigo-50/60" : ""
      } ${l.duplicateOf ? "opacity-50" : ""}`}
    >
      <td className="py-2.5 pr-2 pl-4">
        {l.status === "done" && l.score !== null && l.tier ? (
          <div className="flex items-center gap-2">
            <ScoreRing score={l.score} tier={l.tier} size={38} />
            <TierBadge tier={l.tier} />
          </div>
        ) : (
          <StatusPill lead={l} />
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium text-slate-900">{companyName(l)}</div>
        <div className="text-xs text-slate-500">
          {l.domain}
          {l.duplicateOf && <span className="ml-1.5 text-amber-600">· duplicate</span>}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {p?.ownerName ? (
          <>
            <div className="text-slate-900">{p.ownerName}</div>
            <div className="text-xs text-slate-500 capitalize">{p.ownerTitle?.toLowerCase()}</div>
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {p?.foundedYear ? (
          <>
            <div className="text-slate-900">{p.foundedYear}</div>
            <div className="text-xs text-slate-500">{age} yrs</div>
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
        {[p?.city, p?.state].filter(Boolean).join(", ") || <span className="text-slate-400">—</span>}
      </td>
      <td className="max-w-xs px-3 py-2.5 text-xs">
        {l.status !== "done" ? (
          <span className="text-slate-500">{l.error}</span>
        ) : topReason ? (
          <span className={topReason.kind === "positive" ? "text-emerald-700" : "text-rose-700"}>
            {topReason.kind === "positive" ? "▲" : "▼"} {topReason.label}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function StatusPill({ lead }: { lead: Lead }) {
  const map = {
    queued: "bg-slate-100 text-slate-600",
    crawling: "bg-indigo-50 text-indigo-700 animate-pulse",
    error: "bg-rose-50 text-rose-700",
    blocked: "bg-amber-50 text-amber-700",
    done: "",
  } as const;
  const label = { queued: "Queued", crawling: "Reading site…", error: "Failed", blocked: "robots.txt", done: "" }[
    lead.status
  ];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${map[lead.status]}`}>{label}</span>;
}
