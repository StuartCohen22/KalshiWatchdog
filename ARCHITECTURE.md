# Kalshi Watchdog

Kalshi Watchdog is a prediction-market surveillance demo built for a serverless AWS stack. The application ingests public Kalshi market and trade data, persists it in DynamoDB, runs anomaly detection over resolved markets, enriches suspicious patterns with Bedrock-based narrative analysis, and exposes the results through a React dashboard.

Core modules:

- `backend/utils/kalshi_client.py`: public Kalshi API client using `urllib3`
- `backend/utils/dynamo.py`: DynamoDB read/write helpers for trades, markets, anomalies
- `backend/detection/*.py`: anomaly detection algorithms
- `backend/lambdas/*/handler.py`: Lambda entry points for ingestion, detection, analysis, and API
- `frontend/`: Vite + React + TypeScript dashboard
- `data/known_cases.json`: historical insider-trading reference cases for the UI

The implementation follows the project blueprint provided in the build request.

