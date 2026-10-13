import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { client, MODEL, recordClaudeError } from "./extract.js";
import type { Lead } from "./types.js";

const EmailSchema = z.object({ subject: z.string(), body: z.string() });
export type Email = z.infer<typeof EmailSchema> & { source: "claude" | "template" };

const SYSTEM_PROMPT = `You write first-touch emails from an individual acquisition entrepreneur (a "searcher") to the owner of a small, privately held business.

Goals: be respectful, specific, and short (under 130 words). Show you looked at their business, mention their legacy and what happens to their team and customers, and ask for a 15-minute call. Never claim you have money ready or make an offer. Never invent facts beyond the profile you are given. No exclamation marks, no flattery clichés. Sign off with "[Your name]".`;

export async function draftOutreach(lead: Lead): Promise<Email> {
  const p = lead.profile;
  if (!p) throw new Error("Lead has not been analysed yet");

  if (client) {
    try {
      const facts = {
        company: p.companyName,
        owner: p.ownerName,
        ownerTitle: p.ownerTitle,
        foundedYear: p.foundedYear,
        summary: p.summary,
        services: p.services,
        location: [p.city, p.state].filter(Boolean).join(", "),
        familyOwned: p.familyOwned,
        evidence: p.evidence,
      };
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(EmailSchema) },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Company profile:\n${JSON.stringify(facts, null, 2)}` }],
      });
      if (response.stop_reason !== "refusal" && response.parsed_output) {
        return { ...response.parsed_output, source: "claude" };
      }
    } catch (err) {
      recordClaudeError(err);
      console.warn("[outreach] Claude draft failed, using template:", (err as Error).message);
    }
  }
  return templateEmail(lead);
}

function templateEmail(lead: Lead): Email {
  const p = lead.profile!;
  const company = p.companyName ?? lead.domain;
  const firstName = p.ownerName?.split(" ")[0];
  const years = p.foundedYear ? new Date().getFullYear() - p.foundedYear : null;
  const tenure = years ? `${years} years of building ${company}` : `what you've built at ${company}`;
  const where = p.city ? ` in ${p.city}` : "";

  return {
    source: "template",
    subject: `${company}: a question about the next chapter`,
    body: `Hi ${firstName ?? "there"},

I came across ${company}${where} and was impressed by ${tenure}.

I'm an operator looking to acquire and personally run one business for the long term. I'm not a fund looking to flip it. My priority would be keeping your team, your name and the way you treat customers intact.

If you've ever thought about what succession could look like, even years from now, would you be open to a 15-minute call? No pressure either way.

Best,
[Your name]`,
  };
}
