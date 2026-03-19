"""DynamoDB Streams → WebSocket broadcast + SNS alert for CRITICAL anomalies."""
from __future__ import annotations

import json
import os
from decimal import Decimal

import boto3  # type: ignore
from boto3.dynamodb.types import TypeDeserializer  # type: ignore

CONNECTIONS_TABLE = os.getenv("CONNECTIONS_TABLE_NAME", "kalshi-watchdog-connections")
WS_ENDPOINT = os.getenv("WS_ENDPOINT", "")
ALERT_TOPIC_ARN = os.getenv("ALERT_TOPIC_ARN", "")

dynamodb = boto3.resource("dynamodb")
connections_table = dynamodb.Table(CONNECTIONS_TABLE)
sns = boto3.client("sns") if ALERT_TOPIC_ARN else None
deserializer = TypeDeserializer()


def _deserialize(image: dict) -> dict:
    """Convert DynamoDB Stream NEW_IMAGE format to plain dict."""
    return {k: deserializer.deserialize(v) for k, v in image.items()}


def _decimal_default(obj: object) -> object:
    if isinstance(obj, Decimal):
        return float(obj) if obj % 1 else int(obj)
    raise TypeError


def lambda_handler(event: dict, context: object) -> dict:
    # Collect new anomalies from the stream
    anomalies = []
    for record in event.get("Records", []):
        if record.get("eventName") != "INSERT":
            continue
        new_image = record.get("dynamodb", {}).get("NewImage")
        if not new_image:
            continue
        anomalies.append(_deserialize(new_image))

    if not anomalies:
        return {"statusCode": 200, "body": "No new anomalies."}

    # Get all active WebSocket connections
    response = connections_table.scan(ProjectionExpression="connectionId")
    connections = response.get("Items", [])

    # Set up API Gateway Management API client
    apigw = None
    if WS_ENDPOINT and connections:
        apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)

    stale_ids = []

    for anomaly in anomalies:
        payload = json.dumps(anomaly, default=_decimal_default).encode()

        # Broadcast to all connected WebSocket clients
        for conn in connections:
            cid = conn["connectionId"]
            if cid in stale_ids:
                continue
            try:
                apigw.post_to_connection(Data=payload, ConnectionId=cid)
            except apigw.exceptions.GoneException:
                stale_ids.append(cid)
            except Exception:
                stale_ids.append(cid)

        # Send SNS alert for CRITICAL anomalies
        severity = anomaly.get("severity", "").upper()
        if severity == "CRITICAL" and sns and ALERT_TOPIC_ARN:
            ticker = anomaly.get("ticker", "unknown")
            anomaly_type = anomaly.get("anomaly_type", "unknown")
            summary = anomaly.get("llm_summary", "No summary available.")
            sns.publish(
                TopicArn=ALERT_TOPIC_ARN,
                Subject=f"[CRITICAL] Kalshi Watchdog — {ticker}",
                Message=(
                    f"CRITICAL anomaly detected on {ticker}\n"
                    f"Type: {anomaly_type}\n"
                    f"Summary: {summary}\n"
                ),
            )

    # Clean up stale connections
    for cid in stale_ids:
        try:
            connections_table.delete_item(Key={"connectionId": cid})
        except Exception:
            pass

    return {"statusCode": 200, "body": f"Broadcast {len(anomalies)} anomalies to {len(connections)} clients."}
