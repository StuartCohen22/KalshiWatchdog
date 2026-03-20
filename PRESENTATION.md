# KalshiWatchdog

## Prediction Market Surveillance Platform

**Real-time anomaly detection and AI-powered analysis for the Kalshi prediction market exchange.**

KalshiWatchdog is a fully serverless surveillance platform that monitors trading activity on Kalshi — the first CFTC-regulated prediction market exchange in the United States. It ingests market and trade data via Kalshi's authenticated REST API, runs three anomaly detection algorithms to flag suspicious trading patterns, and uses Claude 3 Haiku (via AWS Bedrock) to generate natural-language intelligence summaries for each flagged anomaly. Results stream to a live React dashboard over WebSocket, and critical alerts fire email/SMS notifications via SNS.

---

## Problem Statement

Prediction markets are a growing asset class, but their relatively thin order books and binary outcome structure make them uniquely vulnerable to insider trading, coordinated manipulation, and information asymmetry exploitation. Traditional market surveillance tools are designed for equities and don't account for the time-bounded, event-driven nature of prediction markets — where a $0.05 contract can become worth $1.00 in hours if someone knows the outcome in advance.

---

## What It Detects

| Algorithm | What It Flags | Example |
|---|---|---|
| **Golden Window** | Low-probability bets placed shortly before market resolution that won — potential insider knowledge | Someone buys "Yes" contracts at $0.08 on a political outcome, 6 hours before it resolves in their favor |
| **Coordinated Activity** | Clusters of trades with similar timing, sizing, and direction suggesting coordinated actors | 12 accounts all buy the same side within a 30-minute window with similar contract sizes |
| **Volume Spike** | Sudden trade volume surges relative to historical baseline in the final hours before settlement | A normally quiet market sees 50x its average hourly volume in the last 4 hours |

Each flagged anomaly is scored by severity (MEDIUM, HIGH, CRITICAL) based on probability deviation, timing proximity to resolution, and trade volume.

---

## Tech Stack

### Frontend
| Technology | Role |
|---|---|
| React 18 + TypeScript | UI framework with type safety |
| Vite | Build tool and dev server |
| Tailwind CSS | Utility-first styling |
| Recharts | Interactive charts — price timelines, volume overlays, orderbook depth |
| React Router | Client-side routing (Dashboard, Anomaly Detail, Markets, Analytics) |
| WebSocket | Real-time anomaly streaming from AWS API Gateway WebSocket |

### Backend
| Technology | Role |
|---|---|
| Python 3.12 | Lambda runtime for all backend logic |
| boto3 | AWS SDK — DynamoDB, Bedrock, SNS, API Gateway Management |
| cryptography | Kalshi RSA authentication (PKCS1v15 signed headers) |
| numpy | Statistical analysis in anomaly detection algorithms |
| urllib3 | HTTP client for Kalshi REST API with rate limiting |

### Infrastructure
| Technology | Role |
|---|---|
| AWS SAM | Infrastructure as Code — entire stack defined in one template |
| CloudFormation | Provisions and manages all 12 AWS services |
| GitHub | Source control, CI trigger for Amplify |

---

## AWS Services (12)

### 1. AWS Lambda (8 functions)
Serverless compute for all backend logic. No servers to manage, scales to zero when idle, and automatically scales up under load.

| Function | Purpose | Trigger |
|---|---|---|
| `ApiFunction` | REST API handler — all HTTP routes | API Gateway `/{proxy+}` |
| `IngestMarketsFunction` | Fetches settled/finalized markets from Kalshi | Step Functions |
| `IngestTradesFunction` | Fetches trade history for ingested markets | Step Functions |
| `RunDetectionFunction` | Runs 3 anomaly detection algorithms + Bedrock AI analysis | Step Functions |
| `AnalyzeAnomalyFunction` | On-demand Bedrock analysis for individual anomalies | API Gateway |
| `WsConnectFunction` | WebSocket `$connect` — stores connection ID in DynamoDB | WebSocket API |
| `WsDisconnectFunction` | WebSocket `$disconnect` — removes stale connection | WebSocket API |
| `WsBroadcastFunction` | Pushes new anomalies to all connected dashboard clients | DynamoDB Streams |

### 2. Amazon DynamoDB (4 tables)
NoSQL database with single-digit millisecond latency. Pay-per-request billing — no capacity planning needed.

| Table | Schema | Purpose |
|---|---|---|
| `kalshi-watchdog-trades` | PK: ticker, SK: created_time | Trade records with price, volume, side |
| `kalshi-watchdog-markets` | PK: ticker, GSI: status + close_time | Market metadata — title, status, result, volume |
| `kalshi-watchdog-anomalies` | PK: anomaly_id | Detected anomalies with severity, flagged trades, AI summary |
| `kalshi-watchdog-connections` | PK: connectionId, TTL enabled | Active WebSocket connections (auto-expire after 2 hours) |

### 3. DynamoDB Streams
Change data capture on the Anomalies table. Every time a new anomaly is inserted, it triggers the WsBroadcast Lambda to push the anomaly to all connected dashboard clients in real time.

### 4. Amazon S3 (2 buckets)
- **Frontend hosting**: Static website hosting for the React SPA — serves the dashboard at a public URL
- **Raw data archive**: Trade data archive with 30-day lifecycle transition to STANDARD_IA for cost optimization

### 5. Amazon API Gateway — REST
Fully managed REST API that proxies all HTTP requests to the API Lambda function. Configured with CORS headers for cross-origin browser requests and X-Ray tracing for request-level visibility.

### 6. Amazon API Gateway — WebSocket
Bidirectional real-time communication channel. The dashboard connects via WebSocket and receives anomalies the instant they're detected — no polling required. Supports `$connect`, `$disconnect`, and `$default` routes with 60-second keepalive pings to prevent idle disconnection.

### 7. AWS Step Functions
Orchestrates the three-stage surveillance pipeline as a state machine:

```
IngestMarkets → IngestTrades → RunDetection
```

Each stage has retry logic (exponential backoff, max 2 attempts). The state machine passes context between stages so detection runs against freshly ingested data.

### 8. Amazon EventBridge
Scheduled rule that triggers the Step Functions pipeline every 2 hours automatically. The platform continuously monitors Kalshi without any manual intervention.

### 9. Amazon Bedrock (Claude 3 Haiku)
AI-powered anomaly analysis. When the detection engine flags suspicious trading patterns, Claude 3 Haiku generates a natural-language intelligence summary explaining:
- What the anomalous pattern looks like
- Why it's suspicious in context
- What a compliance analyst should investigate

Model: `anthropic.claude-3-haiku-20240307-v1:0` via the Bedrock Converse API.

### 10. Amazon SNS
Simple Notification Service topic for critical alerts. When a CRITICAL severity anomaly is detected, SNS publishes an alert with the ticker, anomaly type, and AI summary. Supports email and SMS subscriptions.

### 11. Amazon CloudWatch
Custom monitoring dashboard tracking:
- Lambda invocations and error rates per function
- API Gateway latency (p50, p90, p99)
- DynamoDB read/write capacity consumption
- Pipeline execution success/failure rates

### 12. AWS X-Ray
Distributed tracing across all Lambda functions and API Gateway. Enables end-to-end visibility into request flows — from the browser through API Gateway, Lambda, DynamoDB, and Bedrock.

---

## Architecture Diagram

```
                         ┌──────────────────────────────────┐
                         │        Amazon EventBridge         │
                         │      (scheduled every 2 hours)    │
                         └──────────────┬───────────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────────┐
                         │       AWS Step Functions          │
                         │    ┌──────────────────────┐      │
                         │    │   IngestMarkets       │      │
                         │    │        ↓              │      │
                         │    │   IngestTrades        │      │
                         │    │        ↓              │      │
                         │    │   RunDetection        │──────┼──→ Amazon Bedrock
                         │    └──────────────────────┘      │    (Claude 3 Haiku)
                         └──────────────┬───────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
             ┌────────────┐     ┌────────────┐     ┌──────────────┐
             │  DynamoDB   │     │  DynamoDB   │     │   DynamoDB    │
             │  Markets    │     │   Trades    │     │  Anomalies    │
             └────────────┘     └────────────┘     └──────┬───────┘
                                                          │
                                                   DynamoDB Streams
                                                          │
                                                          ▼
                                                 ┌────────────────┐
                                                 │  WsBroadcast    │
                                                 │    Lambda       │
                                                 └───────┬────────┘
                                                    │         │
                                                    ▼         ▼
                                            ┌──────────┐  ┌──────┐
                                            │ WebSocket │  │ SNS  │
                                            │ API GW    │  │Alert │
                                            └─────┬────┘  └──┬───┘
                                                  │          │
┌──────────────┐    ┌──────────────┐              │          │
│   S3 Static  │    │  REST API    │              │          ▼
│   Website    │───→│  Gateway     │              │     Email/SMS
│  (React SPA) │    └──────┬───────┘              │
└──────────────┘           │                      │
        ↑                  ▼                      │
        │           ┌────────────┐                │
        │           │ ApiFunction │                │
        │           │  (Lambda)   │                │
        │           └────────────┘                │
        │                                         │
        └─────────────── Browser ─────────────────┘
                    (Dashboard UI)
```

---

## Live Endpoints

| Resource | URL |
|---|---|
| Dashboard | `http://kalshi-watchdog-frontend-726773733855.s3-website-us-east-1.amazonaws.com` |
| REST API | `https://p4165lbha3.execute-api.us-east-1.amazonaws.com/prod` |
| WebSocket | `wss://c1bgow1r6c.execute-api.us-east-1.amazonaws.com/prod` |
| CloudWatch Dashboard | `https://us-east-1.console.aws.amazon.com/cloudwatch/home#dashboards:name=kalshi-watchdog` |
| Step Functions Console | `https://us-east-1.console.aws.amazon.com/states/home#/statemachines/view/arn:aws:states:us-east-1:726773733855:stateMachine:kalshi-watchdog-pipeline` |

---

## Current Stats

| Metric | Value |
|---|---|
| Markets monitored | 1,028 |
| Trades ingested | 2,324 |
| Anomalies detected | 89 |
| Critical alerts | 15 |
| AWS services used | 12 |
| Lambda functions | 8 |
| DynamoDB tables | 4 |
| Lines of Python | ~2,500 |
| Lines of TypeScript | ~4,000 |

---

## Infrastructure as Code

The entire platform is defined in a single AWS SAM template (`infra/template.yaml`). Deploy the full stack:

```bash
sam build -t infra/template.yaml
sam deploy --guided
```

Tear down everything:

```bash
aws cloudformation delete-stack --stack-name kalshi-watchdog
```

---

## Key Design Decisions

1. **Serverless-first**: Zero idle cost, automatic scaling, no server maintenance. The entire platform can run for months on AWS Free Tier.

2. **Event-driven architecture**: DynamoDB Streams + WebSocket eliminates polling. Anomalies appear on the dashboard within milliseconds of detection.

3. **AI-augmented analysis**: Raw statistical detection flags patterns; Claude 3 Haiku provides the "why" — turning data points into actionable intelligence summaries.

4. **Dual-mode operation**: The same codebase runs locally (SQLite + SSE) and in AWS (DynamoDB + WebSocket) via the `STORAGE_BACKEND` environment variable. Zero code changes between environments.

5. **Pipeline orchestration**: Step Functions ensures the three-stage pipeline (ingest → detect → analyze) runs reliably with automatic retries, while EventBridge triggers it on a schedule without any cron servers.
