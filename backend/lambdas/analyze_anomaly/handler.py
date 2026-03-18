from __future__ import annotations

import json
from typing import Any

from backend.utils.bedrock import analyze_anomaly
from backend.utils.dynamo import get_anomaly, get_market, update_anomaly_analysis


def _extract_anomaly_id(event: dict[str, Any]) -> str | None:
    if event.get("anomaly_id"):
        return event["anomaly_id"]

    query = event.get("queryStringParameters") or {}
    if query.get("anomaly_id"):
        return query["anomaly_id"]

    body = event.get("body")
    if body:
        try:
            parsed = json.loads(body) if isinstance(body, str) else body
        except json.JSONDecodeError:
            parsed = {}
        return parsed.get("anomaly_id")

    return None


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    anomaly_id = _extract_anomaly_id(payload)
    if not anomaly_id:
        return {"statusCode": 400, "error": "Missing anomaly_id"}

    anomaly = get_anomaly(anomaly_id)
    if not anomaly:
        return {"statusCode": 404, "error": f"Anomaly {anomaly_id} not found"}

    market = get_market(anomaly["ticker"]) or {"title": anomaly.get("market_title", "Unknown")}
    analysis = analyze_anomaly(anomaly, market)
    updated = update_anomaly_analysis(
        anomaly_id=anomaly_id,
        summary=analysis.get("summary", ""),
        reasoning=analysis.get("reasoning", ""),
        severity=analysis.get("severity", anomaly.get("severity", "MEDIUM")),
        explanations=analysis.get("explanations", []),
    )

    return {
        "statusCode": 200,
        "anomaly_id": anomaly_id,
        "analysis": analysis,
        "updated": updated,
    }

