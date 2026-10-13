# Deal Radar

## Setup

### Prerequisites
- **Node.js 22.13 or newer** (check with `node -v`)
- **npm**
- *Optional:* an Anthropic API key. Without one, the app runs in rules-only mode.

### Install and run

```bash
# 1. Get the code
git clone <repo-url>
cd Caprae

# 2. Start the API (terminal 1)
cd server
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY
npm run dev                 # → http://localhost:4000

# 3. Start the web app (terminal 2)
cd web
npm install
npm run dev                 # → http://localhost:5173
```

Open **http://localhost:5173**, click **Load demo list**, then **Analyse**.

### Environment variables (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(empty)_ | Enables AI extraction and email drafting. Leave empty for rules-only mode. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used when a key is set. |
| `PORT` | `4000` | API port. |
| `CORS_ORIGIN` | `http://localhost:5173` | Origins allowed to call the API (comma-separated). |

For a production build of the web app, set `VITE_API_URL` to the API's URL before running `npm run build` in `web/`.

### Check it's running

```bash
curl http://localhost:4000/api/health
```

## Data files

| Path | What it is |
|---|---|
| `sample-data/demo-companies.csv` | Input list loaded by the **Load demo list** button (11 rows, including one deliberate duplicate). A copy is served from `web/public/demo-companies.csv`. |
| `sample-data/demo-results.csv` | Example output: the ranked results for the demo list. |
| `sample-data/demo-results-hubspot.csv` | The same output in HubSpot import format. |
| `server/fixtures/<domain>.demo/` | Fictional company websites used by the demo. Each folder has `index.html`, `about.html` and `contact.html`. Domains ending in `.demo` are read from here instead of the internet; any other domain is fetched live. |
| `server/data/deal-radar.db` | Local SQLite database (page cache, saved jobs and leads). Created automatically on first run; delete it to reset. |

Fixture companies: `lonestar-hvac.demo`, `lonestarheatingandair.demo`, `bluebonnet-pest.demo`, `prairie-electric.demo`, `gulfcoast-plumbing.demo`, `summit-mechanical.demo`, `austin-green-landscaping.demo`, `copperline-roofing.demo`, `toms-auto-repair.demo`, `hill-country-motors.demo`. All are fictional.

To use your own list, upload a CSV with a `domain` or `website` column (optional: `name`, `city`, `state`, `industry`), or paste domains one per line.

## API endpoints

Base URL: `http://localhost:4000`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server status and mode (AI or rules-only) |
| `POST` | `/api/jobs` | Start an analysis. Body: `{ companies: [{ domain, name?, city?, state?, industry? }], thesis: { industries, regions, minYearsInBusiness } }` |
| `GET` | `/api/jobs/:id` | Get a job and all its leads |
| `GET` | `/api/jobs/:id/stream` | Live progress (Server-Sent Events: `snapshot`, `lead`, `progress`, `done`) |
| `POST` | `/api/jobs/:id/rescore` | Re-score a finished job with a new thesis. Body: `{ industries, regions, minYearsInBusiness }` |
| `POST` | `/api/leads/:id/outreach` | Draft an outreach email for one lead |
| `GET` | `/api/jobs/:id/export.csv?format=standard` | Download ranked results as CSV |
| `GET` | `/api/jobs/:id/export.csv?format=hubspot` | Download ranked results in HubSpot format |
