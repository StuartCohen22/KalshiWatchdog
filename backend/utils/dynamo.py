from __future__ import annotations

from decimal import Decimal
import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

TRADES_TABLE_NAME = os.getenv("TRADES_TABLE_NAME", "kalshi-watchdog-trades")
MARKETS_TABLE_NAME = os.getenv("MARKETS_TABLE_NAME", "kalshi-watchdog-markets")
ANOMALIES_TABLE_NAME = os.getenv("ANOMALIES_TABLE_NAME", "kalshi-watchdog-anomalies")
WATCHLIST_TABLE_NAME = os.getenv("WATCHLIST_TABLE_NAME", "kalshi-watchdog-watchlist")
USAGE_TABLE_NAME = os.getenv("USAGE_TABLE_NAME", "kalshi-watchdog-usage")
USER_POOL_ID = os.getenv("USER_POOL_ID", "")
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "sqlite").lower()

LOCAL_DATA_DIR = Path(os.getenv("LOCAL_DATA_DIR", Path(__file__).resolve().parents[2] / "local_data"))
if STORAGE_BACKEND != "dynamodb":
    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)

_store_lock = Lock()


def _to_decimal(value: Any) -> Any:
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, list):
        return [_to_decimal(item) for item in value]
    if isinstance(value, dict):
        return {key: _to_decimal(item) for key, item in value.items()}
    return value


def _from_decimal(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    if isinstance(value, list):
        return [_from_decimal(item) for item in value]
    if isinstance(value, dict):
        return {key: _from_decimal(item) for key, item in value.items()}
    return value


def _local_file(name: str) -> Path:
    return LOCAL_DATA_DIR / f"{name}.json"


def _read_local(name: str) -> list[dict[str, Any]]:
    path = _local_file(name)
    if not path.exists():
        return []
    return json.loads(path.read_text())


def _write_local(name: str, records: list[dict[str, Any]]) -> None:
    path = _local_file(name)
    path.write_text(json.dumps(records, indent=2))


def _choose_backend() -> str:
    if STORAGE_BACKEND == "sqlite":
        return "sqlite"
    if STORAGE_BACKEND == "local":
        return "local"
    if STORAGE_BACKEND == "dynamodb":
        try:
            import boto3  # type: ignore
            from boto3.dynamodb.conditions import Key as _Key  # type: ignore

            globals()["_boto3"] = boto3
            globals()["_Key"] = _Key
            return "dynamodb"
        except Exception:
            return "sqlite"

    # Auto-detect: try DynamoDB, fall back to SQLite
    try:
        import boto3  # type: ignore
        from boto3.dynamodb.conditions import Key as _Key  # type: ignore

        globals()["_boto3"] = boto3
        globals()["_Key"] = _Key
        return "dynamodb"
    except Exception:
        return "sqlite"


BACKEND = _choose_backend()

_sq: Any = None
if BACKEND == "sqlite":
    from utils import sqlite_store as _sq  # type: ignore

if BACKEND == "dynamodb":
    boto3 = globals()["_boto3"]
    Key = globals()["_Key"]
    dynamodb = boto3.resource("dynamodb")
    trades_table = dynamodb.Table(TRADES_TABLE_NAME)
    markets_table = dynamodb.Table(MARKETS_TABLE_NAME)
    anomalies_table = dynamodb.Table(ANOMALIES_TABLE_NAME)
    watchlist_table = dynamodb.Table(WATCHLIST_TABLE_NAME)
    usage_table = dynamodb.Table(USAGE_TABLE_NAME)


def batch_write_trades(trades: list[dict[str, Any]]) -> int:
    if not trades:
        return 0

    if _sq:
        return _sq.batch_write_trades(trades)

    if BACKEND == "dynamodb":
        written = 0
        with trades_table.batch_writer(overwrite_by_pkeys=["ticker", "created_time"]) as batch:
            for trade in trades:
                count = float(trade.get("count", 0) or 0)
                yes_price = int(trade.get("yes_price", 0) or 0)
                no_price = int(trade.get("no_price", 0) or 0)
                side = trade.get("taker_side", "yes")
                price_cents = yes_price if side == "yes" else no_price
                item = {
                    "ticker": trade["ticker"],
                    "created_time": trade["created_time"],
                    "trade_id": trade["trade_id"],
                    "yes_price": yes_price,
                    "no_price": no_price,
                    "count": int(count) if count.is_integer() else Decimal(str(count)),
                    "taker_side": side,
                    "volume_dollars": Decimal(str(round(count * price_cents / 100, 2))),
                }
                batch.put_item(Item=_to_decimal(item))
                written += 1
        return written

    with _store_lock:
        existing = _read_local("trades")
        by_id = {item["trade_id"]: item for item in existing if item.get("trade_id")}
        for trade in trades:
            trade_record = _from_decimal(
                {
                    "ticker": trade["ticker"],
                    "created_time": trade["created_time"],
                    "trade_id": trade["trade_id"],
                    "yes_price": int(trade.get("yes_price", 0) or 0),
                    "no_price": int(trade.get("no_price", 0) or 0),
                    "count": trade.get("count", 0),
                    "taker_side": trade.get("taker_side", "yes"),
                    "volume_dollars": trade.get("volume_dollars", 0),
                }
            )
            by_id[trade_record["trade_id"]] = trade_record

        records = sorted(by_id.values(), key=lambda item: (item.get("ticker", ""), item.get("created_time", "")))
        _write_local("trades", records)
        return len(trades)


def write_market(market: dict[str, Any]) -> None:
    if _sq:
        return _sq.write_market(market)

    if BACKEND == "dynamodb":
        item = {
            "ticker": market["ticker"],
            "event_ticker": market.get("event_ticker"),
            "title": market.get("title", ""),
            "status": market.get("status"),
            "result": market.get("result"),
            "close_time": market.get("close_time"),
            "volume": market.get("volume", 0),
            "last_price": market.get("last_price", 0),
            "category": market.get("category", "unknown"),
            "subtitle": market.get("subtitle", ""),
            "open_time": market.get("open_time"),
            "expiration_time": market.get("expiration_time"),
        }
        markets_table.put_item(Item=_to_decimal(item))
        return

    with _store_lock:
        markets = _read_local("markets")
        by_ticker = {item["ticker"]: item for item in markets if item.get("ticker")}
        by_ticker[market["ticker"]] = _from_decimal(
            {
                "ticker": market["ticker"],
                "event_ticker": market.get("event_ticker"),
                "title": market.get("title", ""),
                "status": market.get("status"),
                "result": market.get("result"),
                "close_time": market.get("close_time"),
                "volume": market.get("volume", 0),
                "last_price": market.get("last_price", 0),
                "category": market.get("category", "unknown"),
                "subtitle": market.get("subtitle", ""),
                "open_time": market.get("open_time"),
                "expiration_time": market.get("expiration_time"),
            }
        )
        _write_local("markets", sorted(by_ticker.values(), key=lambda item: item.get("ticker", "")))


def write_anomaly(anomaly: dict[str, Any]) -> None:
    if _sq:
        return _sq.write_anomaly(anomaly)

    if BACKEND == "dynamodb":
        anomalies_table.put_item(Item=_to_decimal(anomaly))
        return

    with _store_lock:
        anomalies = _read_local("anomalies")
        by_key = {
            item.get("anomaly_key", item.get("anomaly_id")): item
            for item in anomalies
            if item.get("anomaly_id")
        }
        anomaly_key = anomaly.get("anomaly_key", anomaly["anomaly_id"])
        existing = by_key.get(anomaly_key)
        record = _from_decimal(anomaly)
        if existing:
            record["anomaly_id"] = existing["anomaly_id"]
        by_key[anomaly_key] = record
        _write_local("anomalies", sorted(by_key.values(), key=lambda item: item.get("detected_at", ""), reverse=True))


def update_anomaly_analysis(
    anomaly_id: str,
    summary: str,
    reasoning: str,
    severity: str,
    explanations: list[str] | None = None,
) -> dict[str, Any]:
    if _sq:
        return _sq.update_anomaly_analysis(anomaly_id, summary, reasoning, severity, explanations)

    if BACKEND == "dynamodb":
        response = anomalies_table.update_item(
            Key={"anomaly_id": anomaly_id},
            UpdateExpression=(
                "SET llm_summary = :summary, llm_reasoning = :reasoning, "
                "severity = :severity, explanations = :explanations"
            ),
            ExpressionAttributeValues={
                ":summary": summary,
                ":reasoning": reasoning,
                ":severity": severity,
                ":explanations": explanations or [],
            },
            ReturnValues="ALL_NEW",
        )
        return response.get("Attributes", {})

    with _store_lock:
        anomalies = _read_local("anomalies")
        updated: dict[str, Any] | None = None
        for anomaly in anomalies:
            if anomaly.get("anomaly_id") == anomaly_id:
                anomaly["llm_summary"] = summary
                anomaly["llm_reasoning"] = reasoning
                anomaly["severity"] = severity
                anomaly["explanations"] = explanations or []
                updated = anomaly
                break
        _write_local("anomalies", anomalies)
        return updated or {}


def get_market(ticker: str) -> dict[str, Any] | None:
    if _sq:
        return _sq.get_market(ticker)

    if BACKEND == "dynamodb":
        response = markets_table.get_item(Key={"ticker": ticker})
        return response.get("Item")

    for market in _read_local("markets"):
        if market.get("ticker") == ticker:
            return market
    return None


def get_trades_for_market(ticker: str) -> list[dict[str, Any]]:
    if _sq:
        return _sq.get_trades_for_market(ticker)

    if BACKEND == "dynamodb":
        items: list[dict[str, Any]] = []
        response = trades_table.query(KeyConditionExpression=Key("ticker").eq(ticker))
        items.extend(response.get("Items", []))
        while "LastEvaluatedKey" in response:
            response = trades_table.query(
                KeyConditionExpression=Key("ticker").eq(ticker),
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))
        return [_from_decimal(item) for item in items]

    items = [trade for trade in _read_local("trades") if trade.get("ticker") == ticker]
    return sorted(items, key=lambda item: item.get("created_time", ""))


def get_settled_markets(limit: int = 25) -> list[dict[str, Any]]:
    if _sq:
        return _sq.get_settled_markets(limit)

    if BACKEND == "dynamodb":
        results: list[dict[str, Any]] = []
        for status_val in ("settled", "finalized"):
            response = markets_table.query(
                IndexName="status-close-index",
                KeyConditionExpression=Key("status").eq(status_val),
                ScanIndexForward=False,
                Limit=limit,
            )
            results.extend(_from_decimal(item) for item in response.get("Items", []))
        results.sort(key=lambda m: m.get("close_time", ""), reverse=True)
        return results[:limit]

    items = [market for market in _read_local("markets") if market.get("status") in ("settled", "finalized")]
    items.sort(key=lambda item: item.get("close_time", ""), reverse=True)
    return items[:limit]


def get_traded_tickers() -> list[str]:
    if _sq:
        return _sq.get_traded_tickers()

    if BACKEND == "dynamodb":
        items = trades_table.scan(ProjectionExpression="ticker").get("Items", [])
        seen: set[str] = set()
        ordered: list[str] = []
        for item in items:
            ticker = _from_decimal(item).get("ticker")
            if ticker and ticker not in seen:
                seen.add(ticker)
                ordered.append(ticker)
        return ordered

    seen: set[str] = set()
    ordered: list[str] = []
    for trade in _read_local("trades"):
        ticker = trade.get("ticker")
        if ticker and ticker not in seen:
            seen.add(ticker)
            ordered.append(ticker)
    return ordered


def get_recent_settled_markets_with_trades(limit: int = 25) -> list[dict[str, Any]]:
    if _sq:
        return _sq.get_recent_settled_markets_with_trades(limit)

    traded_tickers = set(get_traded_tickers())
    if not traded_tickers:
        return []

    if BACKEND == "dynamodb":
        markets = get_settled_markets(limit=max(limit * 10, 100))
        matched = [market for market in markets if market.get("ticker") in traded_tickers]
        return matched[:limit]

    markets = [market for market in _read_local("markets") if market.get("status") in ("settled", "finalized") and market.get("ticker") in traded_tickers]
    markets.sort(key=lambda item: item.get("close_time", ""), reverse=True)
    return markets[:limit]


_SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def _deduplicate_anomalies(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the highest-severity anomaly per (ticker, anomaly_type) pair."""
    best: dict[str, dict[str, Any]] = {}
    for item in items:
        key = f"{item.get('ticker')}:{item.get('anomaly_type')}"
        existing = best.get(key)
        if existing is None:
            best[key] = item
        else:
            if _SEVERITY_RANK.get(item.get("severity", "LOW"), 3) < _SEVERITY_RANK.get(existing.get("severity", "LOW"), 3):
                best[key] = item
            elif item.get("total_volume", 0) > existing.get("total_volume", 0):
                best[key] = item
    return sorted(best.values(), key=lambda item: (
        _SEVERITY_RANK.get(item.get("severity", "LOW"), 3),
        -float(item.get("total_volume", 0)),
    ))


def get_anomalies(severity: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    if _sq:
        return _sq.get_anomalies(severity, limit)

    if BACKEND == "dynamodb":
        if severity:
            response = anomalies_table.query(
                IndexName="severity-time-index",
                KeyConditionExpression=Key("severity").eq(severity),
                ScanIndexForward=False,
                Limit=limit,
            )
            return [_from_decimal(item) for item in response.get("Items", [])]

        response = anomalies_table.scan(Limit=limit)
        items = response.get("Items", [])
        return sorted((_from_decimal(item) for item in items), key=lambda item: item.get("detected_at", ""), reverse=True)[:limit]

    items = _read_local("anomalies")
    if severity:
        items = [item for item in items if item.get("severity") == severity]
    items = _deduplicate_anomalies(items)
    return items[:limit]


def get_anomaly(anomaly_id: str) -> dict[str, Any] | None:
    if _sq:
        return _sq.get_anomaly(anomaly_id)

    if BACKEND == "dynamodb":
        response = anomalies_table.get_item(Key={"anomaly_id": anomaly_id})
        return _from_decimal(response.get("Item"))

    for anomaly in _read_local("anomalies"):
        if anomaly.get("anomaly_id") == anomaly_id:
            return anomaly
    return None


def get_stats() -> dict[str, int]:
    if _sq:
        return _sq.get_stats()

    if BACKEND == "dynamodb":
        trades_count = trades_table.scan(Select="COUNT").get("Count", 0)
        markets_count = markets_table.scan(Select="COUNT").get("Count", 0)
        
        # Scan anomalies and filter out run_history records
        anomalies_response = anomalies_table.scan()
        anomalies = [
            _from_decimal(item) 
            for item in anomalies_response.get("Items", [])
            if item.get("_record_type") != "run_history"
        ]
    else:
        trades = _read_local("trades")
        markets = _read_local("markets")
        anomalies = _read_local("anomalies")
        trades_count = len(trades)
        markets_count = len(markets)

    critical_alerts = sum(1 for item in anomalies if item.get("severity") == "CRITICAL")
    flagged_tickers = len({item.get("ticker") for item in anomalies if item.get("ticker")})
    detection_rate = int((flagged_tickers / max(markets_count, 1)) * 100)

    return {
        "trades_ingested": trades_count,
        "markets_monitored": markets_count,
        "anomalies_flagged": len(anomalies),
        "critical_alerts": critical_alerts,
        "detection_rate": detection_rate,
    }


def append_run_history(run: dict[str, Any]) -> None:
    if _sq:
        return _sq.append_run_history(run)

    if BACKEND == "dynamodb":
        # Store run history as anomaly-type records with a special prefix
        item = {
            "anomaly_id": f"run:{run.get('ran_at', '')}",
            **run,
            "_record_type": "run_history",
        }
        anomalies_table.put_item(Item=_to_decimal(item))
        return

    with _store_lock:
        history = _read_local("run_history")
        history.append(_from_decimal(run))
        # Keep the last 50 runs
        if len(history) > 50:
            history = history[-50:]
        _write_local("run_history", history)


def get_run_history(limit: int = 20) -> list[dict[str, Any]]:
    if _sq:
        return _sq.get_run_history(limit)

    if BACKEND == "dynamodb":
        response = anomalies_table.scan(
            FilterExpression="attribute_exists(#rt) AND #rt = :v",
            ExpressionAttributeNames={"#rt": "_record_type"},
            ExpressionAttributeValues={":v": "run_history"},
        )
        items = [_from_decimal(item) for item in response.get("Items", [])]
        items.sort(key=lambda x: x.get("ran_at", ""), reverse=True)
        return items[:limit]

    history = _read_local("run_history")
    return list(reversed(history))[:limit]


def add_to_watchlist(user_id: str, ticker: str, category: str | None = None, notes: str = "") -> None:
    if _sq:
        return _sq.add_to_watchlist(user_id, ticker, category, notes)

    if BACKEND == "dynamodb":
        from datetime import datetime, timezone
        watchlist_table.put_item(Item={
            "user_id": user_id,
            "ticker": ticker,
            "category": category or "",
            "notes": notes,
            "added_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        })
        return

    with _store_lock:
        items = _read_local("watchlist")
        items = [i for i in items if not (i.get("user_id") == user_id and i.get("ticker") == ticker)]
        from datetime import datetime, timezone
        items.append({"user_id": user_id, "ticker": ticker, "category": category or "", "notes": notes,
                       "added_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")})
        _write_local("watchlist", items)


def remove_from_watchlist(user_id: str, ticker: str) -> None:
    if _sq:
        return _sq.remove_from_watchlist(user_id, ticker)

    if BACKEND == "dynamodb":
        watchlist_table.delete_item(Key={"user_id": user_id, "ticker": ticker})
        return

    with _store_lock:
        items = _read_local("watchlist")
        items = [i for i in items if not (i.get("user_id") == user_id and i.get("ticker") == ticker)]
        _write_local("watchlist", items)


def get_watchlist(user_id: str) -> list[dict[str, Any]]:
    if _sq:
        return _sq.get_watchlist(user_id)

    if BACKEND == "dynamodb":
        response = watchlist_table.query(
            KeyConditionExpression=Key("user_id").eq(user_id),
        )
        items = response.get("Items", [])
        return sorted(
            [_from_decimal(i) for i in items],
            key=lambda x: x.get("added_at", ""),
            reverse=True,
        )

    items = [i for i in _read_local("watchlist") if i.get("user_id") == user_id]
    return sorted(items, key=lambda x: x.get("added_at", ""), reverse=True)


def get_categories() -> list[str]:
    if _sq:
        return _sq.get_categories()

    if BACKEND == "dynamodb":
        items = markets_table.scan(ProjectionExpression="category").get("Items", [])
        cats = sorted({i["category"] for i in items if i.get("category")})
        return cats

    markets = _read_local("markets")
    return sorted({m.get("category") for m in markets if m.get("category")})


def browse_markets(
    category: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    if _sq:
        return _sq.browse_markets(category, status, q, limit)

    if BACKEND == "dynamodb":
        if status:
            response = markets_table.query(
                IndexName="status-close-index",
                KeyConditionExpression=Key("status").eq(status),
                ScanIndexForward=False,
                Limit=min(limit * 5, 500),
            )
            items = [_from_decimal(i) for i in response.get("Items", [])]
        else:
            response = markets_table.scan(Limit=min(limit * 5, 500))
            items = [_from_decimal(i) for i in response.get("Items", [])]

        if category:
            items = [m for m in items if m.get("category") == category]
        if q:
            q_lower = q.lower()
            items = [m for m in items if q_lower in str(m.get("title", "")).lower()
                     or q_lower in str(m.get("ticker", "")).lower()]
        items.sort(key=lambda m: float(m.get("volume", 0) or 0), reverse=True)
        return items[:limit]

    markets = _read_local("markets")
    if category:
        markets = [m for m in markets if m.get("category") == category]
    if status:
        markets = [m for m in markets if m.get("status") == status]
    if q:
        q_lower = q.lower()
        markets = [m for m in markets if q_lower in str(m.get("title", "")).lower()
                   or q_lower in str(m.get("ticker", "")).lower()]
    markets.sort(key=lambda m: float(m.get("volume", 0) or 0), reverse=True)
    return markets[:limit]


def reset_local_store() -> dict[str, Any]:
    if _sq:
        return _sq.reset_store()

    if BACKEND not in {"local", "sqlite"}:
        raise RuntimeError("reset_local_store is only available with STORAGE_BACKEND=local or sqlite")

    with _store_lock:
        for name in ("trades", "markets", "anomalies"):
            _write_local(name, [])
    return {"backend": BACKEND, "local_data_dir": str(LOCAL_DATA_DIR)}


def storage_status() -> dict[str, Any]:
    if _sq:
        return _sq.storage_status()

    return {
        "backend": BACKEND,
        "local_data_dir": str(LOCAL_DATA_DIR),
        "tables": {
            "trades": TRADES_TABLE_NAME,
            "markets": MARKETS_TABLE_NAME,
            "anomalies": ANOMALIES_TABLE_NAME,
        },
    }


def log_usage(user_id: str, path: str, method: str) -> None:
    """Non-blocking usage log — only runs in DynamoDB mode."""
    if BACKEND != "dynamodb":
        return
    try:
        from datetime import datetime, timezone
        import time as _time
        now = datetime.now(timezone.utc)
        usage_table.put_item(Item={
            "user_id": user_id,
            "timestamp": now.isoformat().replace("+00:00", "Z"),
            "path": path,
            "method": method,
            "ttl": int(_time.time()) + 60 * 60 * 24 * 30,  # 30-day TTL
        })
    except Exception:
        pass


def get_admin_stats() -> dict[str, Any]:
    if BACKEND == "dynamodb":
        try:
            import boto3 as _b3
            cognito = _b3.client("cognito-idp")
            users_resp = cognito.list_users(UserPoolId=USER_POOL_ID, Limit=60)
            total_users = len(users_resp.get("Users", []))
        except Exception:
            total_users = 0

        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat().replace("+00:00", "Z")
        try:
            scan = usage_table.scan(
                FilterExpression="#ts >= :cutoff",
                ExpressionAttributeNames={"#ts": "timestamp"},
                ExpressionAttributeValues={":cutoff": cutoff},
            )
            requests_24h = scan.get("Count", 0)
            active_users = len({item["user_id"] for item in scan.get("Items", [])})
        except Exception:
            requests_24h = 0
            active_users = 0

        return {"total_users": total_users, "requests_24h": requests_24h, "active_users": active_users}

    # SQLite / local — return placeholder
    return {"total_users": 1, "requests_24h": 0, "active_users": 1}


def get_admin_users() -> list[dict[str, Any]]:
    if BACKEND != "dynamodb":
        return [{"user_id": "local", "email": "local@dev", "created": "", "request_count": 0}]
    try:
        import boto3 as _b3
        cognito = _b3.client("cognito-idp")
        users_resp = cognito.list_users(UserPoolId=USER_POOL_ID, Limit=60)
        users = []
        for u in users_resp.get("Users", []):
            attrs = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
            users.append({
                "user_id": attrs.get("sub", u.get("Username", "")),
                "email": attrs.get("email", u.get("Username", "")),
                "created": u.get("UserCreateDate", "").isoformat() if hasattr(u.get("UserCreateDate", ""), "isoformat") else str(u.get("UserCreateDate", "")),
                "status": u.get("UserStatus", ""),
            })
        return users
    except Exception:
        return []


def get_admin_usage(limit: int = 100) -> list[dict[str, Any]]:
    if BACKEND != "dynamodb":
        return []
    try:
        scan = usage_table.scan(Limit=limit)
        items = [_from_decimal(i) for i in scan.get("Items", [])]
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return items[:limit]
    except Exception:
        return []
