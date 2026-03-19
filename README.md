# Kalshi Watchdog

Real-time prediction-market surveillance platform. Detects anomalous trading patterns — volume spikes, coordinated bursts, and golden-window positioning — across Kalshi markets and surfaces them through a multi-page React dashboard with LLM-generated case narratives.

---

## Quick start

### 1. Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cp .env.example .env.local
# Edit .env.local — set KALSHI_API_KEY and KALSHI_RSA_KEY_PATH

export $(grep -v '^#' .env.local | xargs)
python -m backend.local_api
```

Backend runs at `http://127.0.0.1:8000`.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # VITE_LOCAL_API_TARGET=http://127.0.0.1:8000
npm run dev
```

Open `http://127.0.0.1:5173`.

### 3. LLM (optional but recommended)

```bash
ollama pull qwen2.5
ollama serve
```

Detection runs with heuristic fallback if Ollama is unavailable.

---

## Kalshi API credentials

1. Create an account at [kalshi.com](https://kalshi.com) and generate an API key + RSA private key.
2. Store the private key **outside the repo**:

```bash
mkdir -p ~/.kalshi
mv your_key.pem ~/.kalshi/private_key.pem
chmod 600 ~/.kalshi/private_key.pem
```

3. Add to `.env.local`:

```env
KALSHI_API_KEY=your-uuid-api-key
KALSHI_RSA_KEY_PATH=/Users/yourname/.kalshi/private_key.pem
```

---

## Seeding data

To pre-populate historical settled markets with trades and anomaly detection:

```bash
source .env.local && export $(grep -v '^#' .env.local | xargs)
python scripts/seed_demo.py --days-back 90 --market-limit 20
```

Add `--no-llm` to skip LLM analysis and seed faster.

Data persists in `local_data/watchdog.db` (SQLite, WAL mode). Use **Reset anomalies** in the dashboard controls to re-run detection without re-seeding, or **Full reset** to start clean.

---

## Dashboard pages

| Page | Route | Contents |
|---|---|---|
| Dashboard | `/` | Stats bar, pipeline controls, anomaly feed, live detection stream |
| Markets | `/markets` | Live Kalshi watchlist — scan trades, view price chart/depth, anomaly badges |
| Analytics | `/analytics` | Market–anomaly force graph, category/severity breakdowns, timeline scatter |
| Anomaly detail | `/anomalies/:id` | Cluster chart, context-aware metrics, AI narrative, PDF case export |
| Market search | `/search` | Full trade-level market lookup |
| Known cases | `/known-cases` | Historical insider-trading reference cases |

---

## Pipeline

The dashboard **Run full pipeline** button chains three steps:

1. **Ingest markets** — fetches settled markets from the last 30 days via the Kalshi API
2. **Ingest trades** — fetches full trade history per market (skips already-ingested tickers)
3. **Run detection** — volume spike, coordinated activity, golden window; LLM narrative enrichment

Individual pipeline steps and the live SSE detection stream are also accessible separately.

---

## Detection algorithms

| Algorithm | Signal |
|---|---|
| **Volume spike** | Hourly volume exceeds `mean + N×std` across the market's full trade history |
| **Coordinated activity** | High-frequency 5-minute trade clusters with directional consistency |
| **Golden window** | Extreme-probability trades (YES < 5¢ or NO < 5¢) placed shortly before resolution |

---

## Environment variables

| Variable | Description |
|---|---|
| `KALSHI_API_KEY` | UUID API key from kalshi.com |
| `KALSHI_RSA_KEY_PATH` | Absolute path to PEM private key (outside repo) |
| `LOCAL_LLM_BASE_URL` | Ollama endpoint (default: `http://127.0.0.1:11434/v1`) |
| `LOCAL_LLM_MODEL` | Model name (default: `qwen2.5`) |
| `VITE_LOCAL_API_TARGET` | Frontend proxy target (default: `http://127.0.0.1:8000`) |

---

## Notes

- All data is stored locally in SQLite — no AWS account required to run locally.
- The `infra/` directory and `template.yaml` scaffold an AWS serverless deployment (DynamoDB + Lambda + API Gateway) for production use.
- Private keys and `.env*` files are excluded from git via `.gitignore`.
