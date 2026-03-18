#!/usr/bin/env python3
"""
KalshiWatchdog demo seed script.

Fetches historically interesting settled markets from multiple Kalshi series
and runs the full ingest → detection pipeline. Run this once before a demo
to pre-populate the local data store with real, compelling anomaly data.

Usage:
    python scripts/seed_demo.py
    python scripts/seed_demo.py --days-back 90 --market-limit 20
    python scripts/seed_demo.py --skip-reset --no-detection
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow importing backend without installing the package
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load .env.local if present (same pattern as local_api.py)
env_file = ROOT / ".env.local"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            import os
            os.environ.setdefault(key.strip(), value.strip())

from backend.utils.kalshi_client import fetch_events, fetch_markets
from backend.utils.dynamo import reset_local_store, write_market
from backend.lambdas.ingest_trades.handler import lambda_handler as ingest_trades_handler
from backend.lambdas.run_detection.handler import lambda_handler as run_detection_handler


# Market series known to have high volume, political salience, and interesting patterns
TARGET_SERIES = [
    "KXNEXTIRANLEADER",
    "KXPOTUS",
    "KXSENATE",
    "KXUKRAINEWAR",
    "KXGAZA",
    "KXFEDFUNDS",
    "KXNBATRADE",
    "KXSUPREMECOURT",
    # Crypto prediction markets
    "KXBTC",
    "KXETH",
    "KXSOL",
    "KXBTCEND",
    "KXETHUSD",
    "KXBTCUSD",
    "KXCRYPTO",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed KalshiWatchdog with demo data")
    parser.add_argument(
        "--days-back",
        type=int,
        default=90,
        help="How many days back to look for settled markets (default: 90)",
    )
    parser.add_argument(
        "--market-limit",
        type=int,
        default=20,
        help="Max markets to ingest per series (default: 20)",
    )
    parser.add_argument(
        "--skip-reset",
        action="store_true",
        help="Don't reset local data before seeding (append to existing data)",
    )
    parser.add_argument(
        "--no-detection",
        action="store_true",
        help="Skip the detection step",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Skip LLM analysis during detection (faster)",
    )
    return parser.parse_args()


def seed_series(
    series_ticker: str,
    min_settled_ts: int,
    max_settled_ts: int,
    limit: int,
) -> list[dict]:
    """Fetch settled markets for a series in the target date window."""
    try:
        markets = fetch_markets(
            status="settled",
            series_ticker=series_ticker,
            min_settled_ts=min_settled_ts,
            max_settled_ts=max_settled_ts,
            limit=limit,
        )
        for m in markets:
            write_market(m)
        return markets
    except RuntimeError as exc:
        print(f"  [warn] {series_ticker}: {exc}")
        return []


def seed_via_events(min_close_ts: int, limit: int) -> list[dict]:
    """Use events API to discover more settled markets as a fallback."""
    markets_out: list[dict] = []
    try:
        events = fetch_events(limit=60)
        for ev in events:
            event_ticker = ev.get("event_ticker")
            if not event_ticker:
                continue
            try:
                batch = fetch_markets(
                    event_ticker=event_ticker,
                    status="settled",
                    min_close_ts=min_close_ts,
                    limit=10,
                )
                for m in batch:
                    write_market(m)
                    markets_out.append(m)
            except RuntimeError:
                continue
            if len(markets_out) >= limit:
                break
    except RuntimeError as exc:
        print(f"  [warn] events fallback: {exc}")
    return markets_out


def main() -> None:
    args = parse_args()
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=args.days_back)
    min_settled_ts = int(window_start.timestamp())
    max_settled_ts = int(now.timestamp())

    print("\n" + "=" * 50)
    print("  KalshiWatchdog — Demo Seed Script")
    print("=" * 50)
    print(f"  Window:        {window_start.date()} → {now.date()} ({args.days_back}d)")
    print(f"  Market limit:  {args.market_limit} per series")
    print(f"  Reset store:   {not args.skip_reset}")
    print(f"  Run detection: {not args.no_detection}")
    print(f"  Use LLM:       {not args.no_llm}")
    print()

    # ── 1. Optional reset ──────────────────────────────────────────────────────
    if not args.skip_reset:
        print("Resetting local data store...")
        reset_local_store()
        print("  Done.\n")

    # ── 2. Ingest by series ────────────────────────────────────────────────────
    all_markets: list[dict] = []
    print("Fetching settled markets by series:")
    for series in TARGET_SERIES:
        batch = seed_series(series, min_settled_ts, max_settled_ts, args.market_limit)
        status = f"{len(batch)} markets" if batch else "no results (may not exist in window)"
        print(f"  {series:<28} {status}")
        all_markets.extend(batch)

    # ── 3. Events API fallback ─────────────────────────────────────────────────
    print(f"\nSeeking additional markets via events API...")
    extra = seed_via_events(
        min_close_ts=int(window_start.timestamp()),
        limit=30,
    )
    all_markets.extend(extra)
    print(f"  Events API:                      {len(extra)} additional markets")

    print(f"\n  Total markets stored: {len(all_markets)}")

    if not all_markets:
        print(
            "\n[error] No markets found. Try --days-back 180 or check that the Kalshi "
            "API key is set (KALSHI_API_KEY env var)."
        )
        sys.exit(1)

    # ── 4. Ingest full trade history ───────────────────────────────────────────
    print("\nIngesting full trade history (from market open date)...")
    trade_result = ingest_trades_handler(
        {
            "settled_only": True,
            "all_history": True,
            "market_limit": len(all_markets),
        },
        None,
    )
    print(f"  Trades written:   {trade_result.get('ingested', 0):,}")
    print(f"  Tickers covered:  {len(trade_result.get('ingested_tickers', []))}")

    # ── 5. Run detection ───────────────────────────────────────────────────────
    if not args.no_detection:
        analyze_llm = not args.no_llm
        print(f"\nRunning anomaly detection (LLM={'on' if analyze_llm else 'off'})...")
        det_result = run_detection_handler(
            {
                "limit": min(len(all_markets), 50),
                "analyze_with_llm": analyze_llm,
            },
            None,
        )
        anomalies = det_result.get("anomalies_found", 0)
        markets_processed = det_result.get("processed_markets", 0)
        profile = det_result.get("detection_profile", "unknown")
        print(f"  Anomalies found:  {anomalies}")
        print(f"  Markets scored:   {markets_processed}")
        print(f"  Profile:          {profile}")
        if anomalies == 0:
            print(
                "\n  [tip] Zero anomalies can happen if no markets have stored trades. "
                "Try re-running with --days-back 180 for a wider window."
            )

    print("\n" + "=" * 50)
    print("  Seed complete! Start the backend and open the dashboard.")
    print("  → source .env.local && python -m backend.local_api")
    print("  → cd frontend && npm run dev")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    main()
