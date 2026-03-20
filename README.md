# Kalshi Watchdog

Real-time prediction-market surveillance platform. Detects anomalous trading patterns — volume spikes, coordinated bursts, and golden-window positioning — across Kalshi markets and surfaces them through a multi-page React dashboard with AI-generated case narratives powered by Claude 3 Haiku.

**Live Demo:** [Deployed on AWS Amplify](https://main.d1a2b3c4d5e6f7.amplifyapp.com) *(replace with your actual Amplify URL)*

---

## Features

- **3 anomaly detection algorithms** — volume spikes, coordinated activity, golden window positioning
- **AI-powered analysis** — Claude 3 Haiku via AWS Bedrock generates case narratives
- **Dual-mode operation** — runs locally (SQLite + SSE) or on AWS (DynamoDB + WebSocket)
- **Real-time updates** — WebSocket push notifications for new anomalies
- **User authentication** — AWS Cognito with admin dashboard for usage analytics
- **Interactive visualizations** — force graphs, timelines, candlestick charts, orderbook depth
- **Kalshi API integration** — RSA-signed requests for market data, trades, and orderbooks
- **Fully serverless AWS deployment** — 13 AWS services, zero servers to manage

---

## Tech Stack

**Backend:** Python 3.12, AWS Lambda, DynamoDB, Step Functions, EventBridge, Bedrock (Claude 3 Haiku)  
**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Recharts, Framer Motion, AWS Amplify Auth  
**Infrastructure:** AWS SAM, CloudFormation, API Gateway (REST + WebSocket), Cognito, Amplify Hosting, CloudWatch, X-Ray  
**Data:** Kalshi API (RSA-signed), SQLite (local), DynamoDB (cloud), DynamoDB Streams

---

## Quick start (Local Development)

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
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5173`.

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

## AWS Deployment

### Prerequisites
- AWS CLI configured with credentials
- AWS SAM CLI installed
- Kalshi API key and RSA private key

### Deploy backend

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

This creates:
- 8 Lambda functions (API, ingestion, detection, WebSocket handlers)
- 6 DynamoDB tables (Trades, Markets, Anomalies, Connections, Watchlist, Usage)
- API Gateway (REST + WebSocket)
- Cognito User Pool
- Step Functions pipeline
- EventBridge scheduled rule (runs every 2 hours)
- CloudWatch dashboard

### Deploy frontend

1. Push code to GitHub
2. AWS Console → Amplify → New app → Connect repository
3. Configure build settings:
   - **Monorepo root:** `frontend`
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. Add environment variables:
   ```
   VITE_API_BASE_URL=<your-api-gateway-url>
   VITE_WS_URL=<your-websocket-url>
   VITE_USER_POOL_ID=<your-cognito-pool-id>
   VITE_USER_POOL_CLIENT_ID=<your-cognito-client-id>
   VITE_COGNITO_REGION=us-east-1
   ```
5. Deploy — Amplify builds and hosts on every push

### Add admin user

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <your-pool-id> \
  --username <user-id> \
  --group-name admin \
  --region us-east-1
```

---

## Dashboard pages

| Page | Route | Contents |
|---|---|---|
| Dashboard | `/` | Stats bar, pipeline controls, anomaly feed, live detection stream |
| Markets | `/markets` | Live Kalshi watchlist — scan trades, view price chart/depth, anomaly badges |
| Analytics | `/analytics` | Market–anomaly force graph, category/severity breakdowns, timeline scatter |
| Anomaly detail | `/anomalies/:id` | Cluster chart, context-aware metrics, AI narrative, PDF case export |
| Market search | `/search` | Full trade-level market inspector |
| Watchlist | `/watchlist` | Personal market watchlist with category browsing |
| Known cases | `/known-cases` | Historical insider-trading reference cases |
| Admin | `/admin` | User management, API usage analytics, request logs (admin only) |

---

## Detection algorithms

| Algorithm | Signal |
|---|---|
| **Volume spike** | Hourly volume exceeds `mean + N×std` across the market's full trade history |
| **Coordinated activity** | High-frequency 5-minute trade clusters with directional consistency |
| **Golden window** | Extreme-probability trades (YES < 5¢ or NO < 5¢) placed shortly before resolution |

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design, data flow diagrams, and AWS service breakdown.

**Key features:**
- **Dual-mode operation** — single codebase runs locally (SQLite) or on AWS (DynamoDB)
- **Zero-downtime switching** — controlled by `STORAGE_BACKEND` environment variable
- **Real-time push** — SSE (local) or WebSocket (AWS) for live anomaly notifications
- **Serverless pipeline** — Step Functions orchestrates ingestion → detection → analysis
- **AI enrichment** — Claude 3 Haiku generates case narratives via AWS Bedrock

---

## Environment variables

### Backend (`.env.local`)
| Variable | Description |
|---|---|
| `STORAGE_BACKEND` | `sqlite` (local) or `dynamodb` (AWS) |
| `KALSHI_API_KEY` | UUID API key from kalshi.com |
| `KALSHI_RSA_KEY_PATH` | Absolute path to PEM private key (local only) |
| `KALSHI_RSA_KEY_PEM` | Full PEM string (Lambda only, passed via SAM) |
| `LOCAL_DATA_DIR` | SQLite database directory (default: `./local_data`) |
| `ANALYSIS_BACKEND` | `bedrock` (AWS) or `none` (heuristic fallback) |
| `AWS_REGION` | AWS region for Bedrock (default: `us-east-1`) |
| `BEDROCK_MODEL_ID` | Claude model ID (default: `anthropic.claude-3-haiku-20240307-v1:0`) |

### Frontend (`frontend/.env.local`)
| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend API URL |
| `VITE_WS_URL` | WebSocket URL (AWS only) |
| `VITE_USER_POOL_ID` | Cognito User Pool ID (AWS only) |
| `VITE_USER_POOL_CLIENT_ID` | Cognito Client ID (AWS only) |
| `VITE_COGNITO_REGION` | Cognito region (default: `us-east-1`) |

---

## Project structure

```
backend/
  detection/           Anomaly detection algorithms
  lambdas/             8 Lambda function handlers
  utils/               Kalshi client, storage abstraction, Bedrock integration
  local_api.py         Local development server

frontend/src/
  auth/                Cognito authentication (AuthProvider, LoginPage)
  views/               8 dashboard pages
  components/          Reusable UI components
  api/                 API client with JWT token handling

infra/
  template.yaml        AWS SAM template (13 services)

scripts/
  seed_demo.py         Historical data seeding script
```

---

## Notes

- All data is stored locally in SQLite — no AWS account required to run locally
- Private keys and `.env*` files are excluded from git via `.gitignore`
- The platform is designed for hackathon/demo use — production deployment would require additional security hardening
- Bedrock model access is auto-enabled on first invocation (no manual activation needed)

---

## License

MIT

---

## Acknowledgments

Built for the ECU ACM Spark / AWS Track Hackathon. Powered by Kalshi API, AWS Bedrock (Claude 3 Haiku), and 13 AWS services.
