from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid
import statistics


def detect_golden_window(
    trades: list[dict[str, Any]],
    market: dict[str, Any],
    prob_threshold: int = 20,
    hours_threshold: int = 48,
    min_total_volume: float = 0,
) -> dict[str, Any] | None:
    if market.get("status") != "settled" or not market.get("result"):
        return None

    winning_side = market["result"]
    close_time = datetime.fromisoformat(market["close_time"].replace("Z", "+00:00"))
    flagged_trades: list[dict[str, Any]] = []

    for trade in trades:
        created_time = trade.get("created_time")
        if not created_time:
            continue

        trade_time = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
        hours_before = (close_time - trade_time).total_seconds() / 3600
        if hours_before > hours_threshold or hours_before <= 0:
            continue

        if trade.get("taker_side") != winning_side:
            continue

        if winning_side == "yes":
            price_cents = int(trade.get("yes_price", 0) or 0)
            if not price_cents:
                price_cents = int(float(trade.get("yes_price_dollars", "0")) * 100)
        else:
            price_cents = int(trade.get("no_price", 0) or 0)
            if not price_cents:
                price_cents = int(float(trade.get("no_price_dollars", "0")) * 100)

        if price_cents > prob_threshold:
            continue

        count = float(trade.get("count", trade.get("count_fp", 0)) or 0)
        score = (1 - price_cents / 100) * count * (1 / max(hours_before, 0.1))
        flagged_trades.append(
            {
                "trade_id": trade.get("trade_id"),
                "price_cents": price_cents,
                "count": int(count),
                "hours_before": round(hours_before, 1),
                "score": round(score, 2),
                "created_time": created_time,
            }
        )

    if not flagged_trades:
        return None

    total_volume = sum(trade["count"] * trade["price_cents"] / 100 for trade in flagged_trades)
    if total_volume < min_total_volume:
        return None

    min_probability = min(trade["price_cents"] for trade in flagged_trades)
    min_hours = min(trade["hours_before"] for trade in flagged_trades)

    if min_probability <= 10 and min_hours <= 12:
        severity = "CRITICAL"
    elif min_probability <= 20 and min_hours <= 24:
        severity = "HIGH"
    else:
        severity = "MEDIUM"

    # Compute z-score: how many std devs below the market's mean price was the flagged trade?
    all_prices = [
        int(t.get("yes_price" if winning_side == "yes" else "no_price", 0) or 0)
        for t in trades
        if int(t.get("yes_price" if winning_side == "yes" else "no_price", 0) or 0) > 0
    ]
    z_score = 0.0
    if len(all_prices) >= 2:
        try:
            mean_p = statistics.mean(all_prices)
            std_p = statistics.stdev(all_prices)
            if std_p > 0:
                z_score = round((mean_p - min_probability) / std_p, 2)
        except Exception:
            pass

    return {
        "anomaly_id": str(uuid.uuid4()),
        "anomaly_type": "golden_window",
        "ticker": market["ticker"],
        "market_title": market.get("title", ""),
        "severity": severity,
        "trade_count": len(flagged_trades),
        "total_volume": round(total_volume, 2),
        "hours_before_resolution": min_hours,
        "pre_trade_prob": min_probability,
        "resolution": winning_side,
        "z_score": z_score,
        "flagged_trades": flagged_trades,
        "detected_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
