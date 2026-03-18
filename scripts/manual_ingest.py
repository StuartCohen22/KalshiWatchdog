from __future__ import annotations

import argparse
import json

from backend.lambdas.ingest_markets.handler import lambda_handler as ingest_markets
from backend.lambdas.ingest_trades.handler import lambda_handler as ingest_trades


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Kalshi Watchdog ingestion locally.")
    parser.add_argument("--ticker", help="Optional Kalshi market ticker")
    parser.add_argument("--hours-back", type=int, default=24, help="How many hours of trades to fetch")
    parser.add_argument(
        "--skip-markets",
        action="store_true",
        help="Skip market ingestion and only fetch trades",
    )
    args = parser.parse_args()

    if not args.skip_markets:
        print(json.dumps(ingest_markets({"status": "settled"}, None), indent=2))

    print(
        json.dumps(
            ingest_trades({"ticker": args.ticker, "hours_back": args.hours_back}, None),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

