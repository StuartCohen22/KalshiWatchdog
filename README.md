# Kalshi Watchdog

Prediction-market insider-trading surveillance for Kalshi public trade data.

## Stack

- Backend: Python 3.12, Lambda-style handlers, DynamoDB, Bedrock helpers
- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Recharts
- Infra: SAM template scaffold for DynamoDB, Lambda, API Gateway, EventBridge

## Local structure

- `backend/`: ingestion, detection, Bedrock analysis, API handlers
- `frontend/`: dashboard UI
- `data/known_cases.json`: seeded case studies
- `scripts/manual_ingest.py`: local ingestion helper

## Local setup

1. Create a Python environment and install `backend/requirements.txt`.
2. Install frontend dependencies in `frontend/`.
3. Copy `.env.example` and adjust the local LLM settings for your Qwen endpoint.
4. Set `VITE_API_BASE_URL` in the frontend only when pointing to a deployed API.

Example backend env:

```bash
cp .env.example .env.local
export $(grep -v '^#' .env.local | xargs)
```

## Local API

Run the backend API locally without API Gateway:

```bash
cd /Users/stuartcohen/Documents/GitHub/KalshiWatchdog
source .venv/bin/activate
export $(grep -v '^#' .env.local | xargs)
python -m backend.local_api
```

This starts a local server on `http://127.0.0.1:8000`.

Useful Kalshi passthrough endpoints:

- `GET /api/kalshi/markets?status=settled&limit=25`
- `GET /api/kalshi/recon?status=open&limit=8`
- `GET /api/kalshi/trades?ticker=KXMRBEAST-25AUG01-T100M&limit=200`
- `GET /api/kalshi/markets/{ticker}/orderbook`
- `GET /api/kalshi/markets/{ticker}/candlesticks?start_ts=...&end_ts=...&period_interval=60`
- `POST /api/local/ingest-markets`
- `POST /api/local/ingest-trades`
- `POST /api/local/run-detection`

Frontend local env:

```env
VITE_LOCAL_API_TARGET=http://127.0.0.1:8000
```

If `VITE_API_BASE_URL` is unset, Vite proxies `/api/*` to `VITE_LOCAL_API_TARGET`, so local development does not need CORS or absolute URLs.

## Frontend + backend together

Terminal 1:

```bash
cd /Users/stuartcohen/Documents/GitHub/KalshiWatchdog
source .venv/bin/activate
export $(grep -v '^#' .env.local | xargs)
python -m backend.local_api
```

Terminal 2:

```bash
cd /Users/stuartcohen/Documents/GitHub/KalshiWatchdog/frontend
npm install
cp .env.example .env.local
npm run dev
```

Open the Vite URL, typically `http://127.0.0.1:5173`.

Dev behavior:

- `/api/known-cases` and `/api/kalshi/*` use the local backend immediately
- `/api/stats`, `/api/anomalies`, and `/api/markets/{ticker}/trades` use local JSON storage by default
- the dashboard includes a live Kalshi recon panel plus local ingest/detection controls
- analysis uses the configured local OpenAI-compatible model endpoint, with heuristic fallback if the model is unavailable

## Notes

- Kalshi API access in this project is unauthenticated and rate-limited conservatively.
- Bedrock analysis defaults to Claude 3 Haiku in `us-east-1`.
- The repository is scaffolded for hackathon speed, not enterprise deployment rigor.
