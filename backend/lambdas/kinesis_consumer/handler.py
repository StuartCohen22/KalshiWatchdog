"""Kinesis consumer — reads trade records from the stream and writes to DynamoDB."""
from __future__ import annotations

import base64
import json
import os

import boto3  # type: ignore

TABLE_NAME = os.getenv("TRADES_TABLE_NAME", "kalshi-watchdog-trades")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event: dict, context: object) -> dict:
    failures = []

    for i, record in enumerate(event.get("Records", [])):
        try:
            raw = base64.b64decode(record["kinesis"]["data"])
            trade = json.loads(raw)

            ticker = trade.get("ticker")
            created_time = trade.get("created_time")
            if not ticker or not created_time:
                continue

            table.put_item(Item={
                "ticker": ticker,
                "created_time": created_time,
                "trade_id": trade.get("trade_id", ""),
                "count": trade.get("count", 0),
                "yes_price": trade.get("yes_price", 0),
                "no_price": trade.get("no_price", 0),
                "taker_side": trade.get("taker_side", "yes"),
                "volume_dollars": trade.get("volume_dollars", 0),
            })
        except Exception:
            failures.append({"itemIdentifier": record["kinesis"]["sequenceNumber"]})

    return {"batchItemFailures": failures}
