import Papa from "papaparse";
import type { Lead } from "./types.js";

const reasonsText = (lead: Lead) =>
  lead.reasons
    .filter((r) => r.kind !== "neutral")
    .map((r) => `${r.points >= 0 ? "+" : ""}${r.points} ${r.label}`)
    .join("; ");

/** Only analysed, non-duplicate leads, best first. */
const exportable = (leads: Lead[]) =>
  leads.filter((l) => l.status === "done" && !l.duplicateOf).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

export function toStandardCsv(leads: Lead[]): string {
  return Papa.unparse(
    exportable(leads).map((l) => ({
      score: l.score,
      tier: l.tier,
      sell_score: l.sellScore,
      fit_score: l.fitScore,
      company: l.profile?.companyName ?? l.inputName ?? "",
      domain: l.domain,
      owner: l.profile?.ownerName ?? "",
      owner_title: l.profile?.ownerTitle ?? "",
      founded_year: l.profile?.foundedYear ?? "",
      city: l.profile?.city ?? "",
      state: l.profile?.state ?? "",
      industry: l.profile?.industry ?? "",
      email: l.enrichment?.emails[0] ?? "",
      email_domain_verified: l.enrichment?.emailDomainValid ?? "",
      phone: l.enrichment?.phones[0] ?? "",
      summary: l.profile?.summary ?? "",
      reasons: reasonsText(l),
    })),
  );
}

/** Column names match HubSpot's default import properties, so the file maps without manual work. */
export function toHubspotCsv(leads: Lead[]): string {
  return Papa.unparse(
    exportable(leads).map((l) => {
      const [first = "", ...rest] = (l.profile?.ownerName ?? "").split(" ");
      return {
        "Company name": l.profile?.companyName ?? l.inputName ?? "",
        "Company Domain Name": l.domain,
        City: l.profile?.city ?? "",
        "State/Region": l.profile?.state ?? "",
        Industry: l.profile?.industry ?? "",
        "Year Founded": l.profile?.foundedYear ?? "",
        "First Name": first,
        "Last Name": rest.join(" "),
        "Job Title": l.profile?.ownerTitle ?? "",
        Email: l.enrichment?.emails[0] ?? "",
        "Phone Number": l.enrichment?.phones[0] ?? "",
        "Lead Status": l.tier === "hot" ? "OPEN" : "NEW",
        "Deal Radar Score": l.score ?? "",
        "Deal Radar Reasons": reasonsText(l),
      };
    }),
  );
}
