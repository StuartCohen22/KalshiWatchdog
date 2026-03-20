from __future__ import annotations

from decimal import Decimal
import json
from pathlib import Path
import re
from typing import Any

from utils.kalshi_client import (
    fetch_candlesticks,
    fetch_events,
    fetch_markets,
    fetch_orderbook,
    fetch_trades,
)

# Resolve known_cases.json — works both locally (parents[3]) and in Lambda (parents[2])
_HERE = Path(__file__).resolve()
_CANDIDATES = [_HERE.parents[3] / "data" / "known_cases.json", _HERE.parents[2] / "data" / "known_cases.json"]
KNOWN_CASES_PATH = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[0])

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
}


def _get_user_id(event: dict[str, Any]) -> str:
    """Extract user_id from Cognito authorizer claims, fallback to 'local'."""
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    return claims.get("sub") or claims.get("email") or "local"


def _get_user_groups(event: dict[str, Any]) -> list[str]:
    """Extract Cognito groups from authorizer claims."""
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    groups_str = claims.get("cognito:groups", "")
    if not groups_str:
        return []
    return [g.strip() for g in groups_str.split(",") if g.strip()]


def _is_admin(event: dict[str, Any]) -> bool:
    return "admin" in _get_user_groups(event)


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    return str(value)


def _response(status_code: int, payload: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(payload, default=_json_default),
    }


def _parse_int(value: str | None, default: int | None = None) -> int | None:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _parse_json_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if not body:
        return {}
    if isinstance(body, dict):
        return body
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {}


def _path_segments(event: dict[str, Any]) -> list[str]:
    raw_path = (
        event.get("rawPath")
        or event.get("path")
        or event.get("requestContext", {}).get("http", {}).get("path", "")
    )
    return [segment for segment in raw_path.split("/") if segment]


def _dynamo_helpers() -> dict[str, Any]:
    from utils import dynamo

    return {
        "get_anomalies": dynamo.get_anomalies,
        "get_anomaly": dynamo.get_anomaly,
        "get_market": dynamo.get_market,
        "get_stats": dynamo.get_stats,
        "get_trades_for_market": dynamo.get_trades_for_market,
    }


def _try_dynamo_helpers() -> dict[str, Any] | None:
    try:
        return _dynamo_helpers()
    except Exception:
        return None


def _read_known_cases() -> list[dict[str, Any]]:
    return json.loads(KNOWN_CASES_PATH.read_text())


def _case_keywords(case_id: str) -> list[str]:
    mapping = {
        "artem-kaptur-mrbeast": ["mrbeast", "youtube", "video", "creator", "streamer"],
        "california-governor-candidate": ["governor", "election", "candidate", "senate", "mayor"],
        "maduro-capture-polymarket": ["capture", "arrest", "maduro", "venezuela", "sanction"],
        "israeli-military-betting": ["iran", "israel", "military", "missile", "operation", "war"],
        "giannis-conflict": ["nba", "trade", "team", "giannis", "basketball"],
        "crypto-price-manipulation": ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "crypto", "defi"],
    }
    return mapping.get(case_id, [])


def _match_known_cases(market: dict[str, Any], known_cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    haystack = " ".join(
        [
            str(market.get("title", "")),
            str(market.get("subtitle", "")),
            str(market.get("category", "")),
            str(market.get("event_ticker", "")),
        ]
    ).lower()
    matches = []
    for case in known_cases:
        keywords = _case_keywords(case.get("id", ""))
        score = sum(1 for keyword in keywords if keyword in haystack)
        if score > 0:
            matches.append(
                {
                    "id": case["id"],
                    "title": case["title"],
                    "pattern": case["pattern"],
                    "score": score,
                }
            )
    return sorted(matches, key=lambda item: item["score"], reverse=True)[:2]


_CRYPTO_SERIES = {"KXBTC", "KXETH", "KXSOL", "KXBTCEND", "KXETHUSD", "KXBTCUSD", "KXCRYPTO"}


def _is_crypto_market(market: dict[str, Any]) -> bool:
    ticker = str(market.get("ticker", "") or "")
    event_ticker = str(market.get("event_ticker", "") or "")
    for series in _CRYPTO_SERIES:
        if ticker.startswith(series) or event_ticker.startswith(series):
            return True
    title = str(market.get("title", "")).lower()
    return any(token in title for token in ("bitcoin", "ethereum", "solana", "btc", "eth", "sol", "crypto"))


def _market_risk_label(market: dict[str, Any]) -> str:
    volume = float(market.get("display_volume", 0) or market.get("volume", 0) or 0)
    volume_24h = float(market.get("volume_24h", 0) or 0)
    last_price = int(market.get("implied_price", 0) or market.get("last_price", 0) or 0)
    title = str(market.get("title", "")).lower()

    # Crypto markets are always at least "watch" — high volatility = elevated risk
    if _is_crypto_market(market):
        if volume_24h > 2000 or volume > 50000:
            return "heightened"
        return "watch"

    # Heightened: high recent activity or big price dislocation or known hot keywords
    if volume_24h > 5000 or volume > 100000:
        return "heightened"
    if any(token in title for token in ("arrest", "war", "invasion", "coup", "resign", "impeach", "strike")):
        return "heightened"
    # Watch: moderate volume or mid-range probability (more price uncertainty)
    if volume_24h > 500 or volume > 20000 or (20 <= last_price <= 80):
        return "watch"
    return "baseline"


def _clean_title_fragment(value: str) -> str:
    value = re.sub(r"^(yes|no)\s+", "", value.strip(), flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" ,")


def _display_title(market: dict[str, Any]) -> str:
    subtitle = str(market.get("subtitle", "") or "").strip()
    yes_sub_title = str(market.get("yes_sub_title", "") or "").strip()
    raw_title = str(market.get("title", "") or "").strip()

    if subtitle and len(subtitle) > 12:
        return subtitle

    # For "who will X be?" style markets, use the candidate name as the label
    if yes_sub_title and len(yes_sub_title) > 2 and yes_sub_title.lower() not in raw_title.lower():
        question = _clean_title_fragment(raw_title)
        return f"{question} → {yes_sub_title}"

    if raw_title.count(",") >= 2:
        fragments = [_clean_title_fragment(part) for part in raw_title.split(",")]
        unique_fragments: list[str] = []
        seen: set[str] = set()
        for fragment in fragments:
            lowered = fragment.lower()
            if fragment and lowered not in seen:
                seen.add(lowered)
                unique_fragments.append(fragment)
        if unique_fragments:
            return " / ".join(unique_fragments[:3])

    cleaned = _clean_title_fragment(raw_title)
    return cleaned or market.get("ticker", "Untitled market")


def _display_context(market: dict[str, Any]) -> str:
    event_ticker = str(market.get("event_ticker", "") or "")
    category = str(market.get("category", "") or "").replace("_", " ").strip()
    if event_ticker and category:
        return f"{category} / {event_ticker}"
    return category or event_ticker or market.get("ticker", "")


def _is_recon_candidate(market: dict[str, Any]) -> bool:
    from datetime import datetime, timezone, timedelta

    title = str(market.get("title", "") or "")
    subtitle = str(market.get("subtitle", "") or "")
    volume = float(market.get("display_volume", 0) or market.get("volume", 0) or 0)
    last_price = int(market.get("implied_price", 0) or market.get("last_price", 0) or 0)
    signal_text = f"{title} {subtitle}".lower()
    market_type = str(market.get("market_type", "") or "")
    status = str(market.get("status", "") or "").lower()

    # Live watchlist only shows active markets
    if status in ("finalized", "settled", "closed"):
        return False
    if len(_display_title(market)) < 10:
        return False
    if volume <= 0 and last_price == 0:
        return False
    if market_type and market_type not in ("binary", "scalar") and not _is_crypto_market(market):
        return False
    if signal_text.count("yes ") >= 3:
        return False
    if "multigameextended" in str(market.get("ticker", "")).lower():
        return False

    # Exclude ultra-long-horizon markets (closing more than 5 years out) — they clog the feed
    close_time_str = market.get("close_time", "")
    if close_time_str:
        try:
            close_dt = datetime.fromisoformat(close_time_str.replace("Z", "+00:00"))
            if close_dt > datetime.now(timezone.utc) + timedelta(days=365 * 5):
                return False
        except ValueError:
            pass

    return True


def _recon_priority(market: dict[str, Any]) -> tuple[int, float, int]:
    risk_score = {"heightened": 0, "watch": 1, "baseline": 2}.get(_market_risk_label(market), 2)
    volume = -float(market.get("display_volume", 0) or market.get("volume", 0) or 0)
    last_price = abs(50 - int(market.get("implied_price", 0) or market.get("last_price", 0) or 0))
    return (risk_score, volume, last_price)


def _market_recon(status: str = "open", limit: int = 12) -> list[dict[str, Any]]:
    # Serve from SQLite cache if fresh (5-minute TTL)
    try:
        from utils.dynamo import _sq
        if _sq:
            cache_key = f"recon_v2:{status}:{limit}"
            cached = _sq.get_kalshi_cache(cache_key, ttl_seconds=300)
            if cached is not None:
                return cached
    except Exception:
        pass

    known_cases = _read_known_cases()

    all_markets: list[dict[str, Any]] = []
    seen_tickers: set[str] = set()

    def _add(batch: list[dict[str, Any]]) -> None:
        for m in batch:
            t = m.get("ticker")
            if t and t not in seen_tickers:
                seen_tickers.add(t)
                all_markets.append(m)

    # Explicitly fetch crypto series so they always appear
    for series in _CRYPTO_SERIES:
        try:
            _add(fetch_markets(series_ticker=series, status=status, limit=20))
        except RuntimeError:
            pass

    # Primary: broad status fetch for everything else
    try:
        _add(fetch_markets(status=status, limit=200))
    except RuntimeError:
        pass

    # Supplement with event-based discovery if still thin
    if len(all_markets) < limit * 4:
        try:
            events = fetch_events(limit=50)
        except RuntimeError:
            events = []
        for event in events:
            event_ticker = event.get("event_ticker")
            if not event_ticker:
                continue
            try:
                _add(fetch_markets(event_ticker=event_ticker, status=status, limit=20))
            except RuntimeError:
                continue
            if len(all_markets) >= limit * 8:
                break

    enriched = []
    seen_enriched: set[str] = set()
    for market in all_markets:
        ticker = market.get("ticker", "")
        if ticker in seen_enriched:
            continue
        if not _is_recon_candidate(market):
            continue
        seen_enriched.add(ticker)
        enriched.append(
            {
                **market,
                "display_title": _display_title(market),
                "display_context": _display_context(market),
                "risk_label": _market_risk_label(market),
                "historical_parallels": _match_known_cases(market, known_cases),
            }
        )

    enriched.sort(key=_recon_priority)
    result = enriched[:limit]

    # Persist to cache
    try:
        from utils.dynamo import _sq
        if _sq:
            _sq.set_kalshi_cache(f"recon_v2:{status}:{limit}", result)
    except Exception:
        pass

    return result


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    method = (
        payload.get("requestContext", {}).get("http", {}).get("method")
        or payload.get("httpMethod")
        or "GET"
    )

    if method == "OPTIONS":
        return _response(200, {"ok": True})

    query = payload.get("queryStringParameters") or {}
    body = _parse_json_body(payload)
    segments = _path_segments(payload)

    # Log usage for admin metrics (non-blocking)
    user_id = _get_user_id(payload)
    if user_id != "local":
        try:
            from utils.dynamo import log_usage
            log_usage(user_id, "/".join(segments), method)
        except Exception:
            pass

    if segments == [] and method == "GET":
        return _response(
            200,
            {
                "service": "kalshi-watchdog-local-api",
                "message": "Use /api/health for route info",
            },
        )

    if segments == ["api", "health"] and method == "GET":
        return _response(
            200,
            {
                "ok": True,
                "service": "kalshi-watchdog-local-api",
                "routes": [
                    "/api/health",
                    "/api/stats",
                    "/api/anomalies",
                    "/api/anomalies/{id}",
                    "/api/markets/{ticker}/trades",
                    "/api/known-cases",
                    "/api/kalshi/markets",
                    "/api/kalshi/recon",
                    "/api/kalshi/trades",
                    "/api/kalshi/markets/{ticker}/orderbook",
                    "/api/kalshi/markets/{ticker}/candlesticks",
                    "/api/local/storage-status",
                    "/api/local/reset",
                    "/api/local/ingest-markets",
                    "/api/local/ingest-trades",
                    "/api/local/run-detection",
                    "/api/local/analyze-anomaly",
                ],
            },
        )

    if segments == ["api", "anomalies"] and method == "GET":
        dynamo = _try_dynamo_helpers()
        if dynamo is None:
            return _response(200, [])
        severity = query.get("severity")
        limit = int(query.get("limit", "50"))
        return _response(200, dynamo["get_anomalies"](severity=severity, limit=limit))

    if len(segments) == 3 and segments[:2] == ["api", "anomalies"] and method == "GET":
        dynamo = _try_dynamo_helpers()
        if dynamo is None:
            return _response(503, {"error": "DynamoDB backend unavailable"})
        anomaly_id = segments[2]
        anomaly = dynamo["get_anomaly"](anomaly_id)
        if not anomaly:
            return _response(404, {"error": "Anomaly not found"})

        market = dynamo["get_market"](anomaly["ticker"])
        return _response(200, {"anomaly": anomaly, "market": market})

    if len(segments) == 4 and segments[:2] == ["api", "markets"] and segments[3] == "trades" and method == "GET":
        dynamo = _try_dynamo_helpers()
        if dynamo is None:
            return _response(200, [])
        ticker = segments[2]
        return _response(200, dynamo["get_trades_for_market"](ticker))

    if segments == ["api", "stats"] and method == "GET":
        dynamo = _try_dynamo_helpers()
        if dynamo is not None:
            return _response(200, dynamo["get_stats"]())

        settled_markets = fetch_markets(status="settled", limit=25)
        open_markets = fetch_markets(status="open", limit=25)
        return _response(
            200,
            {
                "trades_ingested": 0,
                "markets_monitored": len(settled_markets) + len(open_markets),
                "anomalies_flagged": 0,
                "critical_alerts": 0,
                "detection_rate": 0,
            },
        )

    if segments == ["api", "known-cases"] and method == "GET":
        return _response(200, _read_known_cases())

    if segments == ["api", "kalshi", "markets"] and method == "GET":
        markets = fetch_markets(
            status=query.get("status"),
            limit=_parse_int(query.get("limit"), 100) or 100,
            cursor=query.get("cursor"),
            series_ticker=query.get("series_ticker"),
            event_ticker=query.get("event_ticker"),
            tickers=query.get("tickers"),
            min_close_ts=_parse_int(query.get("min_close_ts")),
            max_close_ts=_parse_int(query.get("max_close_ts")),
            min_settled_ts=_parse_int(query.get("min_settled_ts")),
            max_settled_ts=_parse_int(query.get("max_settled_ts")),
        )
        return _response(200, markets)

    if segments == ["api", "kalshi", "recon"] and method == "GET":
        status = query.get("status", "open")
        limit = _parse_int(query.get("limit"), 12) or 12
        return _response(200, _market_recon(status=status, limit=limit))

    if segments == ["api", "kalshi", "trades"] and method == "GET":
        trades = fetch_trades(
            ticker=query.get("ticker"),
            min_ts=_parse_int(query.get("min_ts")),
            max_ts=_parse_int(query.get("max_ts")),
            limit=_parse_int(query.get("limit"), 100) or 100,
            cursor=query.get("cursor"),
        )
        return _response(200, trades)

    if len(segments) == 5 and segments[:3] == ["api", "kalshi", "markets"] and segments[4] == "orderbook" and method == "GET":
        return _response(200, fetch_orderbook(segments[3]))

    if len(segments) == 5 and segments[:3] == ["api", "kalshi", "markets"] and segments[4] == "candlesticks" and method == "GET":
        start_ts = _parse_int(query.get("start_ts"))
        end_ts = _parse_int(query.get("end_ts"))
        period_interval = _parse_int(query.get("period_interval"))
        if start_ts is None or end_ts is None or period_interval is None:
            return _response(400, {"error": "start_ts, end_ts, and period_interval are required"})
        return _response(
            200,
            fetch_candlesticks(
                segments[3],
                start_ts=start_ts,
                end_ts=end_ts,
                period_interval=period_interval,
            ),
        )

    if (
        len(segments) == 5
        and segments[:3] == ["api", "kalshi", "markets"]
        and segments[4] == "all-trades"
        and method == "GET"
    ):
        all_trades = fetch_trades(ticker=segments[3])
        return _response(200, all_trades)

    if segments == ["api", "local", "storage-status"] and method == "GET":
        from utils.dynamo import storage_status

        return _response(200, storage_status())

    if segments == ["api", "local", "markets"] and method == "GET":
        from utils.dynamo import BACKEND, _sq

        q = (query.get("q") or "").strip().lower()
        limit = _parse_int(query.get("limit"), 20) or 20
        
        # Helper to check if market has trades
        def has_trades(ticker: str) -> bool:
            if _sq:
                return _sq.has_trades_for_ticker(ticker)
            elif BACKEND == "dynamodb":
                from utils.dynamo import trades_table
                try:
                    response = trades_table.query(
                        KeyConditionExpression="ticker = :ticker",
                        ExpressionAttributeValues={":ticker": ticker},
                        Limit=1,
                        ProjectionExpression="ticker"
                    )
                    return len(response.get("Items", [])) > 0
                except Exception:
                    return False
            else:
                from utils.dynamo import _read_local
                trades = _read_local("trades")
                return any(t.get("ticker") == ticker for t in trades)
        
        if _sq:
            markets = _sq.search_markets(q or None, limit * 3)  # Fetch more to account for filtering
        elif BACKEND == "dynamodb":
            from utils.dynamo import markets_table, _from_decimal
            response = markets_table.scan(Limit=min(limit * 5, 500))
            all_markets = [_from_decimal(item) for item in response.get("Items", [])]
            if q:
                all_markets = [
                    m for m in all_markets
                    if q in str(m.get("title", "")).lower()
                    or q in str(m.get("ticker", "")).lower()
                ]
            all_markets.sort(key=lambda m: float(m.get("volume", 0) or 0), reverse=True)
            markets = all_markets
        else:
            from utils.dynamo import _read_local
            all_markets: list[dict[str, Any]] = _read_local("markets")
            if q:
                all_markets = [
                    m for m in all_markets
                    if q in str(m.get("title", "")).lower()
                    or q in str(m.get("ticker", "")).lower()
                ]
            all_markets.sort(key=lambda m: float(m.get("volume", 0) or 0), reverse=True)
            markets = all_markets
        
        # Filter to only markets with trades
        markets_with_trades = [m for m in markets if has_trades(m.get("ticker", ""))]
        return _response(200, markets_with_trades[:limit])

    if segments == ["api", "local", "reset-anomalies"] and method == "POST":
        from utils import dynamo as _dynamo
        if _dynamo._sq:
            return _response(200, _dynamo._sq.reset_anomalies())
        if _dynamo.BACKEND == "dynamodb":
            from utils.dynamo import anomalies_table
            items = anomalies_table.scan(ProjectionExpression="anomaly_id").get("Items", [])
            count = 0
            with anomalies_table.batch_writer() as batch:
                for item in items:
                    batch.delete_item(Key={"anomaly_id": item["anomaly_id"]})
                    count += 1
            return _response(200, {"cleared": "anomalies", "anomalies_removed": count})
        # Fallback for local JSON backend
        from pathlib import Path
        import json as _json
        local_dir = Path(_dynamo.LOCAL_DATA_DIR)
        anomalies_file = local_dir / "anomalies.json"
        count = 0
        if anomalies_file.exists():
            count = len(_json.loads(anomalies_file.read_text()))
            anomalies_file.write_text("[]")
        return _response(200, {"cleared": "anomalies", "anomalies_removed": count})

    if segments == ["api", "local", "reset"] and method == "POST":
        from utils.dynamo import BACKEND, reset_local_store
        if BACKEND == "dynamodb":
            from utils.dynamo import trades_table, markets_table, anomalies_table, _from_decimal
            removed = {"trades": 0, "markets": 0, "anomalies": 0}
            for tbl, key_name, tbl_label in [
                (anomalies_table, ["anomaly_id"], "anomalies"),
                (trades_table, ["ticker", "created_time"], "trades"),
                (markets_table, ["ticker"], "markets"),
            ]:
                items = tbl.scan(ProjectionExpression=", ".join(key_name)).get("Items", [])
                with tbl.batch_writer() as batch:
                    for item in items:
                        batch.delete_item(Key={k: item[k] for k in key_name})
                        removed[tbl_label] += 1
            return _response(200, {"cleared": "all", **removed})
        return _response(200, reset_local_store())

    if segments == ["api", "local", "ingest-markets"] and method == "POST":
        from lambdas.ingest_markets.handler import lambda_handler as ingest_markets

        result = ingest_markets(
            {
                "status": body.get("status", "settled"),
                "hours_back": body.get("hours_back"),
                "limit": body.get("limit", 200),
            },
            None,
        )
        return _response(200, result)

    if segments == ["api", "local", "ingest-trades"] and method == "POST":
        from lambdas.ingest_trades.handler import lambda_handler as ingest_trades

        result = ingest_trades(
            {
                "ticker": body.get("ticker"),
                "hours_back": body.get("hours_back", 168),
                "market_limit": body.get("market_limit", 25),
                "settled_only": body.get("settled_only", False),
                "all_history": body.get("all_history", False),
            },
            None,
        )
        return _response(200, result)

    if segments == ["api", "local", "run-detection"] and method == "POST":
        from lambdas.run_detection.handler import lambda_handler as run_detection

        result = run_detection(
            {
                "limit": body.get("limit", 20),
                "analyze_with_llm": body.get("analyze_with_llm", True),
            },
            None,
        )
        return _response(200, result)

    if segments == ["api", "local", "analyze-anomaly"] and method == "POST":
        from lambdas.analyze_anomaly.handler import lambda_handler as analyze_anomaly

        result = analyze_anomaly({"anomaly_id": body.get("anomaly_id")}, None)
        return _response(200, result)

    if segments == ["api", "local", "run-history"] and method == "GET":
        try:
            from utils.dynamo import get_run_history
            limit = _parse_int(query.get("limit"), 20) or 20
            return _response(200, get_run_history(limit=limit))
        except Exception:
            return _response(200, [])

    if segments == ["api", "kalshi", "explain-market"] and method == "POST":
        from utils.bedrock import explain_market

        ticker = body.get("ticker", "")
        market_data = body.get("market", {})
        if not ticker and not market_data:
            return _response(400, {"error": "ticker or market required"})
        result = explain_market(market_data or {"ticker": ticker})
        return _response(200, result)

    # ── Watchlist ───────────────────────────────────────────────────────────
    if segments == ["api", "watchlist"] and method == "GET":
        from utils.dynamo import get_watchlist, get_market, get_anomalies

        user_id = _get_user_id(payload)
        items = get_watchlist(user_id)
        all_anomalies = get_anomalies(limit=500)
        anomaly_by_ticker: dict[str, int] = {}
        for a in all_anomalies:
            t = a.get("ticker")
            if t:
                anomaly_by_ticker[t] = anomaly_by_ticker.get(t, 0) + 1

        enriched = []
        for item in items:
            ticker = item["ticker"]
            market = get_market(ticker)
            enriched.append({
                **item,
                "market": market,
                "has_anomaly": ticker in anomaly_by_ticker,
                "anomaly_count": anomaly_by_ticker.get(ticker, 0),
            })
        return _response(200, enriched)

    if segments == ["api", "watchlist"] and method == "POST":
        from utils.dynamo import add_to_watchlist
        user_id = _get_user_id(payload)
        ticker = body.get("ticker")
        if not ticker:
            return _response(400, {"error": "ticker required"})
        add_to_watchlist(user_id, ticker, body.get("category"), body.get("notes", ""))
        return _response(200, {"ok": True, "ticker": ticker})

    if len(segments) == 3 and segments[:2] == ["api", "watchlist"] and method == "DELETE":
        from utils.dynamo import remove_from_watchlist
        user_id = _get_user_id(payload)
        remove_from_watchlist(user_id, segments[2])
        return _response(200, {"ok": True, "removed": segments[2]})

    if segments == ["api", "markets", "categories"] and method == "GET":
        from utils.dynamo import get_categories
        return _response(200, get_categories())

    if segments == ["api", "markets", "browse"] and method == "GET":
        from utils.dynamo import browse_markets as _browse
        results = _browse(
            category=query.get("category"),
            status=query.get("status"),
            q=query.get("q"),
            limit=_parse_int(query.get("limit"), 50) or 50,
        )
        return _response(200, results)

    # ── Admin ─────────────────────────────────────────────────────────────
    if segments == ["api", "admin", "stats"] and method == "GET":
        # Note: Auth disabled for demo - in production, check _is_admin(payload)
        from utils.dynamo import get_admin_stats
        return _response(200, get_admin_stats())

    if segments == ["api", "admin", "users"] and method == "GET":
        # Note: Auth disabled for demo - in production, check _is_admin(payload)
        from utils.dynamo import get_admin_users
        return _response(200, get_admin_users())

    if segments == ["api", "admin", "usage"] and method == "GET":
        # Note: Auth disabled for demo - in production, check _is_admin(payload)
        from utils.dynamo import get_admin_usage
        limit = _parse_int(query.get("limit"), 100) or 100
        return _response(200, get_admin_usage(limit=limit))

    return _response(404, {"error": "Not found"})
