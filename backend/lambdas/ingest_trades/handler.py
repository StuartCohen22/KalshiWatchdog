from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from utils.dynamo import batch_write_trades, get_settled_markets, get_traded_tickers
from utils.kalshi_client import fetch_trades

TRADE_STREAM_NAME = os.getenv("TRADE_STREAM_NAME", "")


def _put_to_kinesis(trades: list[dict[str, Any]]) -> None:
    """Optionally write trade records to Kinesis for archival via Firehose → S3."""
    if not TRADE_STREAM_NAME or not trades:
        return
    try:
        import boto3  # type: ignore
        kinesis = boto3.client("kinesis")
        records = [
            {"Data": json.dumps(t).encode(), "PartitionKey": t.get("ticker", "unknown")}
            for t in trades
        ]
        # Kinesis PutRecords accepts up to 500 at a time
        for i in range(0, len(records), 500):
            kinesis.put_records(Records=records[i : i + 500], StreamName=TRADE_STREAM_NAME)
    except Exception as exc:
        print(f"[ingest_trades] Kinesis put failed (non-fatal): {exc}")


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    ticker = payload.get("ticker")
    hours_back = int(payload.get("hours_back", 24))
    market_limit = int(payload.get("market_limit", 25))
    settled_only = bool(payload.get("settled_only", False))
    all_history = bool(payload.get("all_history", False))
    force = bool(payload.get("force", False))  # re-ingest even if trades already exist
    ingested_tickers: list[str] = []

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=hours_back)

    if settled_only and not ticker:
        # Skip markets that already have trades unless force=True
        already_ingested = set(get_traded_tickers()) if not force else set()

        markets = get_settled_markets(limit=market_limit)
        if not markets:
            # No markets in local store — auto-ingest so trades have something to work with
            from lambdas.ingest_markets.handler import lambda_handler as _ingest_markets
            _ingest_markets({"status": "settled", "limit": market_limit}, None)
            markets = get_settled_markets(limit=market_limit)

        written = 0
        for market in markets:
            t = market.get("ticker")
            if not t:
                continue
            if t in already_ingested:
                continue
            ingested_tickers.append(t)

            if all_history:
                open_raw = market.get("open_time") or market.get("created_time")
                try:
                    market_start = (
                        datetime.fromisoformat(open_raw.replace("Z", "+00:00"))
                        if open_raw
                        else start_time
                    )
                except ValueError:
                    market_start = start_time
            else:
                market_start = start_time

            trades = fetch_trades(
                ticker=t,
                min_ts=int(market_start.timestamp()),
                max_ts=int(end_time.timestamp()),
            )
            written += batch_write_trades(trades)
            _put_to_kinesis(trades)
    else:
        trades = fetch_trades(
            ticker=ticker,
            min_ts=int(start_time.timestamp()),
            max_ts=int(end_time.timestamp()),
        )
        written = batch_write_trades(trades)
        _put_to_kinesis(trades)
        if ticker:
            ingested_tickers.append(ticker)

    return {
        "statusCode": 200,
        "ingested": written,
        "ticker": ticker,
        "hours_back": hours_back,
        "settled_only": settled_only,
        "all_history": all_history,
        "ingested_tickers": ingested_tickers,
        "markets_found": len(markets) if settled_only and not ticker else 0,
        "skipped_already_ingested": len(already_ingested) if settled_only and not ticker else 0,
    }
