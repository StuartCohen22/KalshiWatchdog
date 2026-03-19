"""WebSocket $connect handler — stores connection ID in DynamoDB."""
from __future__ import annotations

import json
import os
import time

import boto3  # type: ignore

TABLE_NAME = os.getenv("CONNECTIONS_TABLE_NAME", "kalshi-watchdog-connections")
TTL_SECONDS = 7200  # 2 hours

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event: dict, context: object) -> dict:
    connection_id = event["requestContext"]["connectionId"]
    table.put_item(
        Item={
            "connectionId": connection_id,
            "ttl": int(time.time()) + TTL_SECONDS,
        }
    )
    return {"statusCode": 200, "body": "Connected."}
