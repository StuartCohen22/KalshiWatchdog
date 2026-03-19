from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from utils.dynamo import write_market
from utils.kalshi_client import fetch_markets


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    hours_back = payload.get("hours_back")
    limit = int(payload.get("limit", 200))

    filters: dict[str, Any] = {}
    if hours_back:
        min_close_ts = int((datetime.now(timezone.utc) - timedelta(hours=int(hours_back))).timestamp())
        filters["min_close_ts"] = min_close_ts

    # Fetch settled markets directly — reliable, no event-indirection
    markets: list[dict[str, Any]] = []
    try:
        batch = fetch_markets(status="settled", limit=limit, **filters)
        markets.extend(batch)
    except RuntimeError:
        pass

    # Also fetch finalized markets in case status label differs
    if len(markets) < limit:
        try:
            batch = fetch_markets(status="finalized", limit=limit - len(markets), **filters)
            seen = {m.get("ticker") for m in markets}
            for m in batch:
                if m.get("ticker") not in seen:
                    markets.append(m)
        except RuntimeError:
            pass

    for market in markets[:limit]:
        write_market(market)

    return {
        "statusCode": 200,
        "ingested": len(markets[:limit]),
        "hours_back": hours_back,
    }
