#!/usr/bin/env python3
"""
Backfill local SQLite data to DynamoDB without clearing existing data.
"""
import json
import sqlite3
import sys
from pathlib import Path

import boto3
from decimal import Decimal

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

SQLITE_DB = Path(__file__).parent.parent / "local_data" / "watchdog.db"

# DynamoDB table names
MARKETS_TABLE = "kalshi-watchdog-markets"
TRADES_TABLE = "kalshi-watchdog-trades"
ANOMALIES_TABLE = "kalshi-watchdog-anomalies"


def decimal_default(obj):
    """Convert Decimal to int/float for JSON serialization."""
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def to_dynamo_item(record: dict) -> dict:
    """Convert Python dict to DynamoDB item format, handling Decimals."""
    def convert_value(val):
        if val is None:
            return None
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return Decimal(str(val))
        if isinstance(val, str):
            return val
        if isinstance(val, (list, dict)):
            return json.loads(json.dumps(val, default=decimal_default), parse_float=Decimal)
        return str(val)
    
    return {k: convert_value(v) for k, v in record.items() if v is not None}


def backfill_markets(conn: sqlite3.Connection, dynamodb):
    """Copy markets from SQLite to DynamoDB."""
    table = dynamodb.Table(MARKETS_TABLE)
    cursor = conn.execute("SELECT * FROM markets")
    columns = [desc[0] for desc in cursor.description]
    
    count = 0
    skipped = 0
    
    with table.batch_writer() as batch:
        for row in cursor:
            record = dict(zip(columns, row))
            ticker = record.get("ticker")
            
            # Check if already exists
            try:
                existing = table.get_item(Key={"ticker": ticker})
                if "Item" in existing:
                    skipped += 1
                    continue
            except Exception:
                pass
            
            batch.put_item(Item=to_dynamo_item(record))
            count += 1
            
            if count % 50 == 0:
                print(f"  Markets: {count} added, {skipped} skipped")
    
    print(f"✓ Markets: {count} added, {skipped} skipped (total)")
    return count


def backfill_trades(conn: sqlite3.Connection, dynamodb):
    """Copy trades from SQLite to DynamoDB."""
    table = dynamodb.Table(TRADES_TABLE)
    cursor = conn.execute("SELECT * FROM trades")
    columns = [desc[0] for desc in cursor.description]
    
    count = 0
    skipped = 0
    seen_keys = set()
    
    with table.batch_writer() as batch:
        for row in cursor:
            record = dict(zip(columns, row))
            ticker = record.get("ticker")
            created_time = record.get("created_time")
            key = (ticker, created_time)
            
            # Skip duplicates in local data
            if key in seen_keys:
                skipped += 1
                continue
            seen_keys.add(key)
            
            # Check if already exists in DynamoDB
            try:
                existing = table.get_item(Key={"ticker": ticker, "created_time": created_time})
                if "Item" in existing:
                    skipped += 1
                    continue
            except Exception:
                pass
            
            batch.put_item(Item=to_dynamo_item(record))
            count += 1
            
            if count % 100 == 0:
                print(f"  Trades: {count} added, {skipped} skipped")
    
    print(f"✓ Trades: {count} added, {skipped} skipped (total)")
    return count


def backfill_anomalies(conn: sqlite3.Connection, dynamodb):
    """Copy anomalies from SQLite to DynamoDB."""
    table = dynamodb.Table(ANOMALIES_TABLE)
    cursor = conn.execute("SELECT * FROM anomalies")
    columns = [desc[0] for desc in cursor.description]
    
    count = 0
    skipped = 0
    
    with table.batch_writer() as batch:
        for row in cursor:
            record = dict(zip(columns, row))
            anomaly_id = record.get("anomaly_id")
            
            # Check if already exists
            try:
                existing = table.get_item(Key={"anomaly_id": anomaly_id})
                if "Item" in existing:
                    skipped += 1
                    continue
            except Exception:
                pass
            
            # Parse JSON fields
            for field in ["flagged_trades", "explanations"]:
                if field in record and isinstance(record[field], str):
                    try:
                        record[field] = json.loads(record[field])
                    except (json.JSONDecodeError, TypeError):
                        pass
            
            batch.put_item(Item=to_dynamo_item(record))
            count += 1
            
            if count % 20 == 0:
                print(f"  Anomalies: {count} added, {skipped} skipped")
    
    print(f"✓ Anomalies: {count} added, {skipped} skipped (total)")
    return count


def main():
    if not SQLITE_DB.exists():
        print(f"❌ SQLite database not found: {SQLITE_DB}")
        sys.exit(1)
    
    print(f"📦 Backfilling from {SQLITE_DB} to DynamoDB...")
    print(f"   (Skipping records that already exist)\n")
    
    conn = sqlite3.connect(SQLITE_DB)
    dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
    
    try:
        markets_added = backfill_markets(conn, dynamodb)
        trades_added = backfill_trades(conn, dynamodb)
        anomalies_added = backfill_anomalies(conn, dynamodb)
        
        print(f"\n✅ Backfill complete!")
        print(f"   Markets: {markets_added} new")
        print(f"   Trades: {trades_added} new")
        print(f"   Anomalies: {anomalies_added} new")
        
    finally:
        conn.close()


if __name__ == "__main__":
    main()
