"""WebSocket $disconnect handler — removes connection ID from DynamoDB."""
from __future__ import annotations

import os

import boto3  # type: ignore

TABLE_NAME = os.getenv("CONNECTIONS_TABLE_NAME", "kalshi-watchdog-connections")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event: dict, context: object) -> dict:
    connection_id = event["requestContext"]["connectionId"]
    table.delete_item(Key={"connectionId": connection_id})
    return {"statusCode": 200, "body": "Disconnected."}
