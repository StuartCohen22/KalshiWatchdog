# Kalshi Watchdog — Architecture

Kalshi Watchdog is a full-stack prediction market surveillance platform. It ingests market and trade data from Kalshi (the first CFTC-regulated prediction market exchange), runs anomaly detection algorithms, enriches findings with Claude 3 Haiku AI analysis via AWS Bedrock, and presents results through a React dashboard with Cognito authentication. The platform runs in two modes: **local** (SQLite + SSE) and **cloud** (DynamoDB + WebSocket on AWS), controlled by a single `STORAGE_BACKEND` environment variable with zero code changes.

---

## Stack

| Layer | Local Mode | AWS Mode |
|---|---|---|
| Backend API | Python 3.12, `ThreadingHTTPServer` | AWS Lambda (8 functions) |
| Storage | SQLite (WAL mode) | DynamoDB (6 tables) |
| Real-time push | Server-Sent Events (SSE) | WebSocket via API Gateway v2 |
| AI analysis | Claude 3 Haiku via AWS Bedrock | Claude 3 Haiku via AWS Bedrock |
| Pipeline orchestration | Manual / frontend buttons | Step Functions + EventBridge (every 2h) |
| Authentication | Optional (bypass mode) | AWS Cognito (User Pools + JWT) |
| Frontend | React 18, TypeScript, Vite, Tailwind, Recharts, Framer Motion | Same, hosted on AWS Amplify |
| Kalshi data | RSA-signed REST API (`kalshi_client.py`) | Same |
| Infra | `.env.local` | AWS SAM (`infra/template.yaml`) |

---

## Dual-mode operation

The `STORAGE_BACKEND` environment variable controls which storage layer is used:

- **`sqlite`** (default for local dev): All data stored in `local_data/watchdog.db` via `backend/utils/sqlite_store.py`
- **`dynamodb`** (Lambda default): All data stored in DynamoDB tables via `backend/utils/dynamo.py`

Every storage function (`batch_write_trades`, `get_anomalies`, `add_to_watchlist`, etc.) dispatches to the correct backend at runtime. The API handler (`lambdas/api/handler.py`) works identically in both modes.

**Local dev**: `source .env.local && python -m backend.local_api`
**AWS**: SAM deploys all Lambda functions with `STORAGE_BACKEND=dynamodb` set globally.

---

## Directory layout

```
backend/
  local_api.py              ThreadingHTTPServer — wraps Lambda handler for local dev
  detection/
    coordinated.py          Coordinated burst detection (z-score + time clustering)
    golden_window.py        Longshot bet detection near resolution
    volume_spike.py         Per-hour volume spike detection
  lambdas/
    api/handler.py          All HTTP routes (runs behind API Gateway or local server)
    ingest_markets/         Fetch + persist settled markets from Kalshi
    ingest_trades/          Fetch + persist full trade history per market
    run_detection/          Run all detectors, write anomaly records
    analyze_anomaly/        On-demand Bedrock AI analysis for individual anomalies
    ws_connect/             WebSocket $connect — store connection ID in DynamoDB
    ws_disconnect/          WebSocket $disconnect — remove connection ID
    ws_broadcast/           DynamoDB Streams trigger — push anomalies to WebSocket clients
  utils/
    kalshi_client.py        Kalshi API client (RSA auth, candlesticks, orderbook, trades)
    sqlite_store.py         SQLite backend — trades, markets, anomalies, watchlist, run_log
    bedrock.py              Claude 3 Haiku via AWS Bedrock (heuristic fallback)
    dynamo.py               Storage dispatcher — routes to SQLite or DynamoDB

frontend/src/
  auth/
    AuthProvider.tsx        AWS Amplify Cognito integration + auth context
    LoginPage.tsx           Sign in/up/confirm UI with gradient design
  views/
    Dashboard.tsx           Overview: stats bar, controls, anomaly feed, live stream
    Markets.tsx             Kalshi market recon with scan buttons and anomaly badges
    Analytics.tsx           Force graph, category/severity charts, anomaly timeline
    AnomalyDetail.tsx       Per-anomaly deep-dive: cluster chart, metrics, PDF export
    MarketSearch.tsx        Full trade-level market inspector
    Watchlist.tsx           Personal market watchlist with category browsing
    KnownCases.tsx          Historical insider-trading reference cases
    Admin.tsx               Admin dashboard: user management, API usage, request logs
  components/
    StatsBar.tsx            Live stats (trades, markets, anomalies) — 60s polling
    AnomalyFeed.tsx         Sorted anomaly list with severity badges
    LiveDetectionStream.tsx WebSocket (AWS) or SSE (local) real-time detection stream
    LocalControlPanel.tsx   Pipeline controls: run full pipeline, reset
    MarketReconPanel.tsx    Live open-market watchlist: scan, price chart, depth
  api/client.ts             All API calls: anomalies, markets, trades, watchlist, pipeline ops
  types/index.ts            Shared TypeScript types

infra/
  template.yaml             AWS SAM template — all cloud resources

data/
  known_cases.json          Historical insider-trading reference cases

scripts/
  seed_demo.py              Seeds historical data for demo
```

---

## Data flow

### Local mode
```
Kalshi API
    │
    ▼
kalshi_client.py  (RSA-signed HTTP requests)
    │
    ├─► ingest_markets  →  SQLite: markets table
    │
    └─► ingest_trades   →  SQLite: trades table
                               │
                               ▼
                         run_detection
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             coordinated  golden_window  volume_spike
                    │
                    ▼
             bedrock.py  (Claude 3 Haiku → AI narrative)
                    │
                    ▼
             SQLite: anomalies table
                    │
                    ▼
             local_api.py  ──SSE──►  React dashboard
```

### AWS mode
```
EventBridge (every 2h)
    │
    ▼
Step Functions: IngestMarkets → IngestTrades → RunDetection
    │                                              │
    ▼                                              ▼
DynamoDB: Markets, Trades                    Bedrock (Claude 3 Haiku)
                                                   │
                                                   ▼
                                            DynamoDB: Anomalies
                                                   │
                                            DynamoDB Streams (INSERT)
                                                   │
                                                   ▼
                                            WsBroadcast Lambda
                                                   │
                                                   ▼
                                            WebSocket API → React dashboard
                                            (push to authenticated clients)
```

---

## AWS Services (13)

| # | Service | Role |
|---|---------|------|
| 1 | **Lambda** | 8 functions — API, ingest, detection, analysis, WebSocket handlers |
| 2 | **DynamoDB** | 6 tables — Trades, Markets, Anomalies, Connections, Watchlist, Usage |
| 3 | **DynamoDB Streams** | Triggers WsBroadcast on new anomaly INSERT |
| 4 | **API Gateway REST** | All HTTP routes → ApiFunction Lambda with Cognito authorizer |
| 5 | **API Gateway WebSocket** | Real-time anomaly push to dashboard clients |
| 6 | **Step Functions** | Pipeline orchestration: IngestMarkets → IngestTrades → RunDetection |
| 7 | **EventBridge** | Scheduled rule — triggers pipeline every 2 hours |
| 8 | **Bedrock** | Claude 3 Haiku AI analysis of anomalies |
| 9 | **S3** | Raw data archive with 30-day STANDARD_IA lifecycle |
| 10 | **Cognito** | User authentication (User Pools, JWT tokens, admin group) |
| 11 | **Amplify** | Frontend hosting with CI/CD from GitHub |
| 12 | **CloudWatch** | Custom dashboard — Lambda metrics, API latency, DynamoDB capacity |
| 13 | **X-Ray** | Distributed tracing across all Lambda functions |

---

## Authentication & Authorization

### Local mode
- Auth is optional — if `VITE_USER_POOL_ID` and `VITE_USER_POOL_CLIENT_ID` are absent, the frontend bypasses authentication entirely
- All API routes are accessible without tokens

### AWS mode
- **Cognito User Pool** manages user registration, sign-in, and JWT token issuance
- **API Gateway Cognito Authorizer** validates JWT tokens on all `/api/*` routes
- **Admin group** grants access to `/api/admin/*` endpoints (user management, usage metrics)
- **Usage tracking** logs all API requests to DynamoDB with TTL for analytics
- Frontend uses **AWS Amplify Auth** for sign-in/sign-up flows and automatic token refresh

---

## API routes

### Authentication-protected routes (AWS mode)
All routes require a valid Cognito JWT token in the `Authorization: Bearer <token>` header.

### Kalshi passthrough
| Method | Path | Description |
|---|---|---|
| GET | `/api/kalshi/markets` | Market listing (status, limit, series_ticker params) |
| GET | `/api/kalshi/recon` | Risk-ranked open markets for surveillance |
| GET | `/api/kalshi/trades` | Trades for a ticker |
| GET | `/api/kalshi/markets/{ticker}/orderbook` | Bid/ask depth |
| GET | `/api/kalshi/markets/{ticker}/candlesticks` | OHLC candlestick data |
| POST | `/api/kalshi/explain-market` | Claude 3 Haiku market explanation |

### Data queries
| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | Aggregate counts (trades, markets, anomalies) |
| GET | `/api/anomalies` | Anomaly records (severity, limit params) |
| GET | `/api/anomalies/{id}` | Single anomaly with market data |
| GET | `/api/markets/{ticker}/trades` | Stored trades for a ticker |
| GET | `/api/known-cases` | Historical insider-trading reference cases |
| GET | `/api/local/run-history` | Pipeline run log |
| GET | `/api/markets/categories` | Unique market categories |
| GET | `/api/markets/browse` | Browse markets (category, status, search) |

### Watchlist (user-scoped)
| Method | Path | Description |
|---|---|---|
| GET | `/api/watchlist` | User's watchlisted markets with anomaly flags |
| POST | `/api/watchlist` | Add ticker to user's watchlist |
| DELETE | `/api/watchlist/{ticker}` | Remove from user's watchlist |

### Admin routes (requires admin group membership)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stats` | System stats: total users, 24h requests, active users |
| GET | `/api/admin/users` | List all registered users |
| GET | `/api/admin/usage` | Recent API request logs |

### Pipeline operations
| Method | Path | Description |
|---|---|---|
| POST | `/api/local/ingest-markets` | Fetch + store settled markets |
| POST | `/api/local/ingest-trades` | Fetch + store trades (auto-ingests markets if needed) |
| POST | `/api/local/run-detection` | Run detectors + AI analysis |
| POST | `/api/local/reset-anomalies` | Clear anomalies (keeps trades/markets) |
| POST | `/api/local/reset` | Full reset — wipe all data |
| GET | `/api/local/detection-stream` | SSE stream (local mode only) |

---

## Anomaly detection algorithms

### Volume spike (`detection/volume_spike.py`)
Bins trades into hourly buckets. Flags hours where volume exceeds `mean + N*std` across the market's full trade history. Severity scales with z-score.

### Coordinated activity (`detection/coordinated.py`)
Detects bursts of trades within short time windows (5-minute clusters). Flags clusters with high trade count and directional consistency.

### Golden window (`detection/golden_window.py`)
Flags trades placed on extreme-probability markets (low-price contracts) shortly before resolution. High notional on longshots signals informed positioning.

---

## Kalshi API authentication

Kalshi API requests use RSA signing:
- **Local**: `KALSHI_RSA_KEY_PATH` — path to PEM private key (stored outside repo at `~/.kalshi/private_key.pem`)
- **Lambda**: `KALSHI_RSA_KEY_PEM` — full PEM string passed via SAM parameter
- `KALSHI_API_KEY` — UUID API key from kalshi.com account

The private key is **never committed** — `.gitignore` covers `*.pem`, `*.key`, and all `.env*` files.

---

## AI analysis

`backend/utils/bedrock.py` calls Claude 3 Haiku (`anthropic.claude-3-haiku-20240307-v1:0`) via the AWS Bedrock `InvokeModel` API. Each flagged anomaly gets a structured JSON analysis: summary, reasoning, severity assessment, and possible explanations. Falls back to heuristic analysis if Bedrock is unavailable.

---

## Deployment

The entire AWS stack is defined in `infra/template.yaml` (SAM template):

```bash
sam build -t infra/template.yaml
sam deploy \
  --stack-name kalshi-watchdog \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    KalshiApiKey=<your-api-key> \
    "KalshiRsaKeyPem=$(cat ~/.kalshi/private_key.pem)"
```

Frontend deployment via AWS Amplify:
1. Push code to GitHub
2. AWS Console → Amplify → New app → Connect repository
3. Set monorepo root to `frontend`
4. Add environment variables (API URLs, Cognito pool IDs)
5. Deploy — Amplify builds and hosts on every push

Tear down:
```bash
aws cloudformation delete-stack --stack-name kalshi-watchdog
```

---

## Technology stack summary

**Backend:** Python 3.12, AWS Lambda, DynamoDB, Step Functions, EventBridge, Bedrock (Claude 3 Haiku)  
**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Recharts, Framer Motion, AWS Amplify Auth  
**Infrastructure:** AWS SAM, CloudFormation, API Gateway (REST + WebSocket), Cognito, Amplify Hosting, CloudWatch, X-Ray  
**Data:** Kalshi API (RSA-signed), SQLite (local), DynamoDB (cloud), DynamoDB Streams

---

## Dual-mode operation

The `STORAGE_BACKEND` environment variable controls which storage layer is used:

- **`sqlite`** (default for local dev): All data stored in `local_data/watchdog.db` via `backend/utils/sqlite_store.py`
- **`dynamodb`** (Lambda default): All data stored in DynamoDB tables via `backend/utils/dynamo.py`

Every storage function (`batch_write_trades`, `get_anomalies`, `add_to_watchlist`, etc.) dispatches to the correct backend at runtime. The API handler (`lambdas/api/handler.py`) works identically in both modes.

**Local dev**: `source .env.local && python -m backend.local_api`
**AWS**: SAM deploys all Lambda functions with `STORAGE_BACKEND=dynamodb` set globally.

---

## Directory layout

```
backend/
  local_api.py              ThreadingHTTPServer — wraps Lambda handler for local dev
  detection/
    coordinated.py          Coordinated burst detection (z-score + time clustering)
    golden_window.py        Longshot bet detection near resolution
    volume_spike.py         Per-hour volume spike detection
  lambdas/
    api/handler.py          All HTTP routes (runs behind API Gateway or local server)
    ingest_markets/         Fetch + persist settled markets from Kalshi
    ingest_trades/          Fetch + persist full trade history per market
    run_detection/          Run all detectors, write anomaly records
    analyze_anomaly/        On-demand Bedrock AI analysis for individual anomalies
    ws_connect/             WebSocket $connect — store connection ID in DynamoDB
    ws_disconnect/          WebSocket $disconnect — remove connection ID
    ws_broadcast/           DynamoDB Streams trigger — push anomalies to WebSocket clients
  utils/
    kalshi_client.py        Kalshi API client (RSA auth, candlesticks, orderbook, trades)
    sqlite_store.py         SQLite backend — trades, markets, anomalies, watchlist, run_log
    bedrock.py              Claude 3 Haiku via AWS Bedrock (heuristic fallback)
    dynamo.py               Storage dispatcher — routes to SQLite or DynamoDB

frontend/src/
  views/
    Dashboard.tsx           Overview: stats bar, controls, anomaly feed, live stream
    Markets.tsx             Kalshi market recon with scan buttons and anomaly badges
    Analytics.tsx           Force graph, category/severity charts, anomaly timeline
    AnomalyDetail.tsx       Per-anomaly deep-dive: cluster chart, metrics, PDF export
    MarketSearch.tsx         Full trade-level market inspector
    Watchlist.tsx           Personal market watchlist with category browsing
    KnownCases.tsx          Historical insider-trading reference cases
  components/
    StatsBar.tsx            Live stats (trades, markets, anomalies) — 60s polling
    AnomalyFeed.tsx         Sorted anomaly list with severity badges
    LiveDetectionStream.tsx WebSocket (AWS) or SSE (local) real-time detection stream
    LocalControlPanel.tsx   Pipeline controls: run full pipeline, reset
    MarketReconPanel.tsx    Live open-market watchlist: scan, price chart, depth
  api/client.ts             All API calls: anomalies, markets, trades, watchlist, pipeline ops
  types/index.ts            Shared TypeScript types

infra/
  template.yaml             AWS SAM template — all cloud resources

data/
  known_cases.json          Historical insider-trading reference cases

scripts/
  seed_demo.py              Seeds historical data for demo
```

---

## Data flow

### Local mode
```
Kalshi API
    │
    ▼
kalshi_client.py  (RSA-signed HTTP requests)
    │
    ├─► ingest_markets  →  SQLite: markets table
    │
    └─► ingest_trades   →  SQLite: trades table
                               │
                               ▼
                         run_detection
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             coordinated  golden_window  volume_spike
                    │
                    ▼
             bedrock.py  (Claude 3 Haiku → AI narrative)
                    │
                    ▼
             SQLite: anomalies table
                    │
                    ▼
             local_api.py  ──SSE──►  React dashboard
```

### AWS mode
```
EventBridge (every 2h)
    │
    ▼
Step Functions: IngestMarkets → IngestTrades → RunDetection
    │                                              │
    ▼                                              ▼
DynamoDB: Markets, Trades                    Bedrock (Claude 3 Haiku)
                                                   │
                                                   ▼
                                            DynamoDB: Anomalies
                                                   │
                                            DynamoDB Streams (INSERT)
                                                   │
                                                   ▼
                                            WsBroadcast Lambda
                                                   │
                                            ┌──────┴──────┐
                                            ▼             ▼
                                      WebSocket API    SNS Alert
                                      (push to UI)    (CRITICAL only)
```

---

## AWS Services (12)

| # | Service | Role |
|---|---------|------|
| 1 | **Lambda** | 8 functions — API, ingest, detection, analysis, WebSocket handlers |
| 2 | **DynamoDB** | 5 tables — Trades, Markets, Anomalies, Connections, Watchlist |
| 3 | **DynamoDB Streams** | Triggers WsBroadcast on new anomaly INSERT |
| 4 | **API Gateway REST** | All HTTP routes → ApiFunction Lambda |
| 5 | **API Gateway WebSocket** | Real-time anomaly push to dashboard clients |
| 6 | **Step Functions** | Pipeline orchestration: IngestMarkets → IngestTrades → RunDetection |
| 7 | **EventBridge** | Scheduled rule — triggers pipeline every 2 hours |
| 8 | **Bedrock** | Claude 3 Haiku AI analysis of anomalies |
| 9 | **S3** | Raw data archive with 30-day STANDARD_IA lifecycle |
| 10 | **SNS** | CRITICAL anomaly alerts via email/SMS |
| 11 | **CloudWatch** | Custom dashboard — Lambda metrics, API latency, DynamoDB capacity |
| 12 | **X-Ray** | Distributed tracing across all Lambda functions |

---

## API routes

### Kalshi passthrough
| Method | Path | Description |
|---|---|---|
| GET | `/api/kalshi/markets` | Market listing (status, limit, series_ticker params) |
| GET | `/api/kalshi/recon` | Risk-ranked open markets for surveillance |
| GET | `/api/kalshi/trades` | Trades for a ticker |
| GET | `/api/kalshi/markets/{ticker}/orderbook` | Bid/ask depth |
| GET | `/api/kalshi/markets/{ticker}/candlesticks` | OHLC candlestick data |
| POST | `/api/kalshi/explain-market` | Claude 3 Haiku market explanation |

### Data queries
| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | Aggregate counts (trades, markets, anomalies) |
| GET | `/api/anomalies` | Anomaly records (severity, limit params) |
| GET | `/api/anomalies/{id}` | Single anomaly with market data |
| GET | `/api/markets/{ticker}/trades` | Stored trades for a ticker |
| GET | `/api/known-cases` | Historical insider-trading reference cases |
| GET | `/api/local/run-history` | Pipeline run log |
| GET | `/api/markets/categories` | Unique market categories |
| GET | `/api/markets/browse` | Browse markets (category, status, search) |

### Watchlist
| Method | Path | Description |
|---|---|---|
| GET | `/api/watchlist` | All watchlisted markets with anomaly flags |
| POST | `/api/watchlist` | Add ticker to watchlist |
| DELETE | `/api/watchlist/{ticker}` | Remove from watchlist |

### Pipeline operations
| Method | Path | Description |
|---|---|---|
| POST | `/api/local/ingest-markets` | Fetch + store settled markets |
| POST | `/api/local/ingest-trades` | Fetch + store trades (auto-ingests markets if needed) |
| POST | `/api/local/run-detection` | Run detectors + AI analysis |
| POST | `/api/local/reset-anomalies` | Clear anomalies (keeps trades/markets) |
| POST | `/api/local/reset` | Full reset — wipe all data |
| GET | `/api/local/detection-stream` | SSE stream (local mode only) |

---

## Anomaly detection algorithms

### Volume spike (`detection/volume_spike.py`)
Bins trades into hourly buckets. Flags hours where volume exceeds `mean + N*std` across the market's full trade history. Severity scales with z-score.

### Coordinated activity (`detection/coordinated.py`)
Detects bursts of trades within short time windows (5-minute clusters). Flags clusters with high trade count and directional consistency.

### Golden window (`detection/golden_window.py`)
Flags trades placed on extreme-probability markets (low-price contracts) shortly before resolution. High notional on longshots signals informed positioning.

---

## Authentication

Kalshi API requests use RSA signing:
- **Local**: `KALSHI_RSA_KEY_PATH` — path to PEM private key (stored outside repo at `~/.kalshi/private_key.pem`)
- **Lambda**: `KALSHI_RSA_KEY_PEM` — base64-encoded PEM string passed via SAM parameter
- `KALSHI_API_KEY` — UUID API key from kalshi.com account

The private key is **never committed** — `.gitignore` covers `*.pem`, `*.key`, `Shmoney.txt`, and all `.env*` files.

---

## AI analysis

`backend/utils/bedrock.py` calls Claude 3 Haiku (`anthropic.claude-3-haiku-20240307-v1:0`) via the AWS Bedrock `InvokeModel` API. Each flagged anomaly gets a structured JSON analysis: summary, reasoning, severity assessment, and possible explanations. Falls back to heuristic analysis if Bedrock is unavailable.

---

## Deployment

The entire AWS stack is defined in `infra/template.yaml` (SAM template):

```bash
sam build -t infra/template.yaml
sam deploy --guided
```

Tear down:
```bash
aws cloudformation delete-stack --stack-name kalshi-watchdog
```
