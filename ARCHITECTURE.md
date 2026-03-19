# Kalshi Watchdog — Architecture

Kalshi Watchdog is a local-first prediction-market surveillance platform. It ingests Kalshi trade and market data, runs anomaly detection, enriches findings with an LLM narrative, and presents results through a multi-page React dashboard.

---

## Stack

| Layer | Technology |
|---|---|
| Backend API | Python 3.12, `http.server.ThreadingHTTPServer` |
| Storage | SQLite (WAL mode) via `backend/utils/sqlite_store.py` |
| Kalshi data | `backend/utils/kalshi_client.py` — RSA-signed requests |
| LLM analysis | Local Ollama (`qwen2.5` or compatible) via OpenAI-compatible API |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts, react-force-graph-2d |
| Infra scaffold | AWS SAM (`template.yaml`) — DynamoDB + Lambda + API Gateway, not required locally |

---

## Directory layout

```
backend/
  local_api.py              ThreadingHTTPServer — all local API routes
  detection/
    coordinated.py          Coordinated burst detection (z-score + time clustering)
    golden_window.py        Longshot bet detection near resolution
    volume_spike.py         Per-hour volume spike detection
  lambdas/
    api/handler.py          Lambda-compatible API handler (proxied by local_api)
    ingest_markets/         Fetch + persist settled markets from Kalshi
    ingest_trades/          Fetch + persist full trade history per market
    run_detection/          Run all detectors, write anomaly records
    analyze_anomaly/        LLM narrative enrichment via Ollama
  utils/
    kalshi_client.py        Kalshi API client (RSA auth, candlesticks, orderbook, trades)
    sqlite_store.py         SQLite read/write — trades, markets, anomalies, run_log
    bedrock.py              LLM call wrapper (local Ollama endpoint)
    dynamo.py               DynamoDB helpers (AWS deployment only)

frontend/src/
  views/
    Dashboard.tsx           Overview: stats bar, controls, anomaly feed, live stream
    Markets.tsx             Kalshi watchlist with scan buttons and anomaly badges
    Analytics.tsx           Force graph, category/severity charts, anomaly timeline
    AnomalyDetail.tsx       Per-anomaly deep-dive: cluster chart, metrics, PDF export
    MarketSearch.tsx        Full trade-level market search
    KnownCases.tsx          Historical insider-trading reference cases
  components/
    StatsBar.tsx            Live stats (trades, markets, anomalies) — 60s polling
    AnomalyFeed.tsx         Sorted anomaly list with severity badges
    LiveDetectionStream.tsx SSE-based real-time detection event stream
    LocalControlPanel.tsx   Pipeline controls: run full pipeline, reset anomalies, full reset
    MarketReconPanel.tsx    Live open-market watchlist: scan, price chart, depth, explain
    ForceGraph.tsx          react-force-graph-2d — market/anomaly/case network
    AnomalyTimeline.tsx     Recharts scatter — anomaly timing vs. resolution
    CategoryBreakdown.tsx   Recharts pie — anomalies by type
    SeverityBreakdown.tsx   Recharts bar — anomalies by severity
    PriceVolumeOverlay.tsx  Candlestick + volume bars with cluster fingerprint
    MarketPriceChart.tsx    Recharts area chart for open-market price history
    OrderbookChart.tsx      Bid/ask depth visualization
  api/client.ts             All API calls: anomalies, markets, trades, pipeline ops, scan
  types/index.ts            Shared TypeScript types

data/
  known_cases.json          Seeded historical insider-trading cases

scripts/
  seed_demo.py              Seeds historical settled markets + trades + detection for demo
  seed_data.py              Lighter seed script
  manual_ingest.py          One-off manual ingestion helper
```

---

## Data flow

```
Kalshi API
    │
    ▼
kalshi_client.py  (RSA-signed HTTP requests)
    │
    ├─► ingest_markets  →  sqlite: markets table
    │
    └─► ingest_trades   →  sqlite: trades table  (skips already-ingested tickers)
                               │
                               ▼
                         run_detection
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             coordinated  golden_window  volume_spike
                    │
                    ▼
             analyze_anomaly  (Ollama → LLM narrative + severity)
                    │
                    ▼
             sqlite: anomalies table
                    │
                    ▼
             local_api.py  →  React dashboard
```

---

## Local API routes

### Kalshi passthrough
| Method | Path | Description |
|---|---|---|
| GET | `/api/kalshi/markets` | Market listing (status, limit params) |
| GET | `/api/kalshi/recon` | Watchlist candidates sorted by risk signal |
| GET | `/api/kalshi/trades` | Trades for a ticker |
| GET | `/api/kalshi/markets/{ticker}/orderbook` | Bid/ask depth |
| GET | `/api/kalshi/markets/{ticker}/candlesticks` | OHLC candlestick data |

### Local data
| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | Aggregate counts from SQLite |
| GET | `/api/anomalies` | All anomaly records (limit param) |
| GET | `/api/anomalies/{id}` | Single anomaly with full trade log |
| GET | `/api/markets/{ticker}/trades` | Local trades for a ticker |
| GET | `/api/known-cases` | Historical reference cases |
| GET | `/api/run-history` | Pipeline run log |

### Pipeline operations
| Method | Path | Description |
|---|---|---|
| POST | `/api/local/ingest-markets` | Fetch + store settled markets |
| POST | `/api/local/ingest-trades` | Fetch + store trades (incremental) |
| POST | `/api/local/run-detection` | Run detectors + LLM analysis |
| POST | `/api/local/reset-anomalies` | Clear anomalies only, keep trades/markets |
| POST | `/api/local/reset` | Full reset — wipe all local data |
| GET | `/api/local/detection-stream` | SSE stream — live anomaly events during detection |

---

## Anomaly detection algorithms

### Volume spike (`detection/volume_spike.py`)
Bins trades into hourly buckets. Flags hours where volume exceeds `mean + N×std` across the market's full trade history. Severity scales with z-score.

### Coordinated activity (`detection/coordinated.py`)
Detects bursts of trades within short time windows (5-minute clusters). Flags clusters with high trade count and directional consistency. Emits `cluster_start`, `cluster_end`, `cluster_direction` for chart fingerprinting.

### Golden window (`detection/golden_window.py`)
Flags trades placed on extreme-probability markets (YES < 5¢ or NO < 5¢) shortly before resolution. High notional on longshots signals informed positioning.

---

## Authentication

Kalshi API requests use RSA signing:
- `KALSHI_API_KEY` — UUID API key from kalshi.com account
- `KALSHI_RSA_KEY_PATH` — path to PEM private key (stored outside the repo at `~/.kalshi/private_key.pem`)

The private key is **never committed** — `.gitignore` covers `*.pem`, `*.key`, `Shmoney.txt`, and all `.env*` files.

---

## LLM analysis

`backend/utils/bedrock.py` calls a local Ollama endpoint (`http://127.0.0.1:11434`) using the OpenAI-compatible API. Default model: `qwen2.5`. The LLM generates a narrative for each flagged anomaly and may adjust severity. Detection runs with heuristic fallback if Ollama is unavailable.

---

## AWS scaffold (not required locally)

`template.yaml` scaffolds the production stack:
- DynamoDB tables: Markets, Trades, Anomalies
- Lambda functions: IngestMarkets, IngestTrades, RunDetection, AnalyzeAnomaly, Api
- API Gateway HTTP API
- EventBridge scheduled rules for the ingestion pipeline

`backend/utils/dynamo.py` contains the DynamoDB equivalents of `sqlite_store.py` for deployed use.
