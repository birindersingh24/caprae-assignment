import express, { type Request, type Response } from "express";
import cors from "cors";
import { CreateJobSchema, ThesisSchema } from "./types.js";
import { createJob, jobEvents, rescoreJob } from "./jobs.js";
import { getJob, getLead, getLeads } from "./db.js";
import { claudeEnabled, claudeStatus, MODEL } from "./extract.js";
import { draftOutreach } from "./outreach.js";
import { toHubspotCsv, toStandardCsv } from "./export.js";

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",") }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: claudeEnabled ? "claude" : "heuristic",
    model: claudeEnabled ? MODEL : null,
    claudeError: claudeStatus.lastError,
  });
});

app.post("/api/jobs", (req, res) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const job = createJob(parsed.data.companies, parsed.data.thesis);
  res.status(201).json(job);
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job, leads: getLeads(job.id) });
});

/** Re-score an existing job with a new thesis (no re-crawling). */
app.post("/api/jobs/:id/rescore", (req, res) => {
  const thesis = ThesisSchema.safeParse(req.body);
  if (!thesis.success) {
    res.status(400).json({ error: "Invalid thesis", issues: thesis.error.issues });
    return;
  }
  if (getJob(req.params.id)?.status === "running") {
    res.status(409).json({ error: "Job is still running" });
    return;
  }
  const result = rescoreJob(req.params.id, thesis.data);
  if (!result) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(result);
});

/** Server-Sent Events: a snapshot first, then one event per lead update until the job finishes. */
app.get("/api/jobs/:id/stream", (req: Request<{ id: string }>, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send("snapshot", { job, leads: getLeads(job.id) });
  const emitter = jobEvents.get(job.id);
  if (!emitter || job.status === "done") {
    send("done", job);
    res.end();
    return;
  }

  const onLead = (lead: unknown) => send("lead", lead);
  const onProgress = (p: unknown) => send("progress", p);
  const onDone = (j: unknown) => {
    send("done", j);
    res.end();
  };
  emitter.on("lead", onLead);
  emitter.on("progress", onProgress);
  emitter.once("done", onDone);
  req.on("close", () => {
    emitter.off("lead", onLead);
    emitter.off("progress", onProgress);
    emitter.off("done", onDone);
  });
});

app.post("/api/leads/:id/outreach", async (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead?.profile) {
    res.status(404).json({ error: "Lead not found or not analysed yet" });
    return;
  }
  res.json(await draftOutreach(lead));
});

app.get("/api/jobs/:id/export.csv", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }
  const hubspot = req.query.format === "hubspot";
  const csv = hubspot ? toHubspotCsv(getLeads(job.id)) : toStandardCsv(getLeads(job.id));
  res
    .set("Content-Type", "text/csv")
    .set("Content-Disposition", `attachment; filename="deal-radar-${hubspot ? "hubspot" : "leads"}.csv"`)
    .send(csv);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Deal Radar API on http://localhost:${port} (${claudeEnabled ? `Claude: ${MODEL}` : "heuristic mode, no API key"})`);
});
