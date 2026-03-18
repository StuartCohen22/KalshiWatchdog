# CODEX.md

## Purpose

This file is the working handoff document for future Codex/agent sessions on `KalshiWatchdog`.

The repository started from an AWS-oriented hackathon blueprint, but the current implementation has been redirected toward a **local-first development workflow**:

- local backend server instead of API Gateway for development
- local JSON-backed storage instead of requiring DynamoDB to iterate
- local OpenAI-compatible LLM endpoint for anomaly narratives instead of requiring Bedrock
- React frontend wired to the local API through Vite proxy

Agents should optimize for **getting the local product loop working cleanly first**, then worry about production hardening.

## Current Product Goal

Build a local demo of a prediction-market surveillance app that:

1. fetches Kalshi market/trade data
2. stores a retrospective settled-market cohort locally
3. runs anomaly detection on that exact cohort
4. generates local Qwen-based narratives
5. shows:
   - a curated live watchlist
   - anomaly feed
   - detail pages with charts/timelines
   - historical precedent context

## Current State

### What exists

- Backend API server: [backend/local_api.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/local_api.py)
- API route handler: [backend/lambdas/api/handler.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/lambdas/api/handler.py)
- Kalshi client: [backend/utils/kalshi_client.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/utils/kalshi_client.py)
- Local/dynamo storage abstraction: [backend/utils/dynamo.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/utils/dynamo.py)
- Local/Bedrock analysis abstraction: [backend/utils/bedrock.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/utils/bedrock.py)
- Detection engine: [backend/lambdas/run_detection/handler.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/lambdas/run_detection/handler.py)
- Detection algorithms:
  - [backend/detection/volume_spike.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/detection/volume_spike.py)
  - [backend/detection/golden_window.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/detection/golden_window.py)
  - [backend/detection/coordinated.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/detection/coordinated.py)
- Dashboard and local controls:
  - [frontend/src/views/Dashboard.tsx](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend/src/views/Dashboard.tsx)
  - [frontend/src/components/MarketReconPanel.tsx](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend/src/components/MarketReconPanel.tsx)
  - [frontend/src/components/LocalControlPanel.tsx](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend/src/components/LocalControlPanel.tsx)

### What works

- Local API boot path exists.
- Frontend talks to local backend through Vite proxy.
- Local storage defaults to JSON files in `/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/local_data`.
- Kalshi recon/watchlist endpoint exists.
- Local ingest/detection endpoints exist.
- Local anomaly analysis supports an OpenAI-compatible endpoint for Qwen.
- Python backend compiles successfully with `python3 -m compileall backend scripts`.

### What is still weak

- The local retrospective ingest/detection loop is not yet guaranteed to yield good anomalies on every run.
- Watchlist curation is improved, but still heuristic and can surface awkward market titles or low-signal contracts.
- Local storage is JSON-only, which is acceptable for debugging but poor for inspection/querying at scale.
- The frontend needs more reliable population of metrics and anomaly density.

## Exact Local Runbook

### Backend

```bash
cd /Users/stuartcohen/Documents/GitHub/KalshiWatchdog
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env.local
export $(grep -v '^#' .env.local | xargs)
python -m backend.local_api
```

### Frontend

```bash
cd /Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend
npm install
cp .env.example .env.local
npm run dev
```

### Browser

Open the Vite URL, typically:

- `http://127.0.0.1:5173`

Hard refresh after backend/frontend changes:

- macOS: `Cmd+Shift+R`

## Local Environment Variables

Root `.env.local`:

```env
STORAGE_BACKEND=local
LOCAL_DATA_DIR=/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/local_data
ANALYSIS_BACKEND=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODEL=qwen2.5
```

Frontend `.env.local`:

```env
VITE_LOCAL_API_TARGET=http://127.0.0.1:8000
```

Notes:

- If `VITE_API_BASE_URL` is unset, Vite proxies `/api/*` to `VITE_LOCAL_API_TARGET`.
- If the local LLM is unavailable, the backend falls back to heuristic summaries.

## Important API Routes

### Health and debugging

- `GET /api/health`
- `GET /api/local/storage-status`

### Kalshi data

- `GET /api/kalshi/markets`
- `GET /api/kalshi/recon`
- `GET /api/kalshi/trades`
- `GET /api/kalshi/markets/{ticker}/orderbook`
- `GET /api/kalshi/markets/{ticker}/candlesticks`

### Local pipeline

- `POST /api/local/reset`
- `POST /api/local/ingest-markets`
- `POST /api/local/ingest-trades`
- `POST /api/local/run-detection`
- `POST /api/local/analyze-anomaly`

### Frontend data

- `GET /api/stats`
- `GET /api/anomalies`
- `GET /api/anomalies/{id}`
- `GET /api/markets/{ticker}/trades`
- `GET /api/known-cases`

## Intended Local User Flow

From the dashboard:

1. `Reset local data`
2. `Ingest settled markets`
3. `Ingest retrospective trades`
4. `Run detection + Qwen`

Expected result:

- `local_data/markets.json` populated
- `local_data/trades.json` populated
- `local_data/anomalies.json` populated with either:
  - threshold-driven anomalies
  - or demo-mode fallback candidate anomalies

## Current Debugging Checklist

If the backend seems broken:

1. hit `curl http://127.0.0.1:8000/api/health`
2. check backend terminal logs; `backend/local_api.py` prints request paths
3. verify `frontend/.env.local` points to `http://127.0.0.1:8000`
4. restart both backend and frontend processes

If the watchlist looks wrong:

1. inspect `GET /api/kalshi/recon?status=open&limit=3`
2. verify derived fields:
   - `display_title`
   - `display_context`
   - `display_volume`
   - `display_volume_label`
   - `implied_price`
3. adjust recon filtering/sorting in [backend/lambdas/api/handler.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/lambdas/api/handler.py)

If anomaly count is zero:

1. inspect the local control message for:
   - `processed_markets`
   - `candidate_markets`
   - `stored_trade_tickers`
   - `detection_profile`
2. inspect:
   - `/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/local_data/markets.json`
   - `/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/local_data/trades.json`
   - `/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/local_data/anomalies.json`
3. confirm the detector is running on settled markets with stored trades
4. if necessary, tune the demo thresholds in [backend/lambdas/run_detection/handler.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/lambdas/run_detection/handler.py)

## Current Architectural Decisions

### 1. Local-first over production-first

Do not prioritize AWS deployment unless explicitly asked. The user wants a working local product loop first.

### 2. JSON storage is temporary

Current local storage uses JSON because it was fastest to get running.

If persistence/querying becomes painful, the preferred upgrade path is:

1. `SQLite`
2. `DuckDB`
3. `Postgres` only if service semantics and richer relational behavior are clearly needed

### 3. Demo-mode anomaly generation is intentional

`DETECTION_PROFILE=demo` is currently the right default for local iteration. It lowers thresholds and allows a fallback candidate anomaly path so the interface is not empty.

This is acceptable for demo development as long as the UI clearly distinguishes:

- hard-threshold anomalies
- demo candidates

### 4. Watchlist and anomaly datasets are different

The watchlist should be based on curated `open` markets.
The anomaly engine should score a retrospective `settled` cohort.

Do not force a single dataset to satisfy both use cases.

## Priority Next Steps

### Highest value

1. Replace the current multi-step ingest logic with a true **backtest batch**:
   - fetch recent settled markets
   - persist that market cohort
   - fetch trades for those exact tickers
   - run detection on exactly those tickers
   - persist a run summary

2. Improve anomaly determinism:
   - add run-level metadata
   - make it obvious why a market was or was not flagged
   - expose thresholds in the UI or config

3. Upgrade local storage from JSON to SQLite if iteration continues.

### Medium value

1. Improve watchlist curation:
   - better title normalization
   - category-based filtering
   - better ranking by activity/price dislocation/event sensitivity

2. Improve anomaly detail:
   - show candidate status clearly
   - show more raw trade evidence
   - improve chart highlighting

3. Improve historical precedent matching:
   - current logic is keyword-based
   - replace with a better rule-based or embedding-assisted matcher later

## Files That Matter Most

If another agent needs to get up to speed fast, start here:

- [CODEX.md](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/CODEX.md)
- [README.md](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/README.md)
- [backend/lambdas/api/handler.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/lambdas/api/handler.py)
- [backend/lambdas/run_detection/handler.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/lambdas/run_detection/handler.py)
- [backend/utils/kalshi_client.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/utils/kalshi_client.py)
- [backend/utils/dynamo.py](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/backend/utils/dynamo.py)
- [frontend/src/views/Dashboard.tsx](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend/src/views/Dashboard.tsx)
- [frontend/src/components/MarketReconPanel.tsx](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend/src/components/MarketReconPanel.tsx)
- [frontend/src/components/LocalControlPanel.tsx](/Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend/src/components/LocalControlPanel.tsx)

## What Not To Do

- Do not introduce Postgres as the first fix for the current issue set.
- Do not optimize for Bedrock/AWS before the local loop is trustworthy.
- Do not assume zero anomalies means the LLM failed; it usually means the data cohort and detection logic did not line up.
- Do not revert the local-first path back to AWS-only unless the user explicitly asks.

## Recommended Next Agent Prompt

If another agent is picking this up, a good next prompt is:

> Read `CODEX.md`. Implement a deterministic local backtest batch that fetches a settled market cohort, ingests trades for those exact tickers, runs detection on that cohort only, persists a run summary locally, and updates the dashboard to show the run metadata and reasons markets were or were not flagged.
