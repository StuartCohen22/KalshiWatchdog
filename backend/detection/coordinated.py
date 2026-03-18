from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
import uuid
import statistics


def detect_coordinated_activity(
    trades: list[dict[str, Any]],
    market: dict[str, Any],
    window_minutes: int = 5,
    min_cluster_size: int = 3,
    min_total_volume: float = 0,
) -> list[dict[str, Any]]:
    if len(trades) < min_cluster_size:
        return []

    sorted_trades = sorted(trades, key=lambda trade: trade.get("created_time", ""))
    current_cluster: list[dict[str, Any]] = [sorted_trades[0]]
    clusters: list[list[dict[str, Any]]] = []

    for index in range(1, len(sorted_trades)):
        previous = sorted_trades[index - 1]
        current = sorted_trades[index]
        prev_time = datetime.fromisoformat(previous["created_time"].replace("Z", "+00:00"))
        curr_time = datetime.fromisoformat(current["created_time"].replace("Z", "+00:00"))
        time_diff = (curr_time - prev_time).total_seconds() / 60
        same_direction = current.get("taker_side") == previous.get("taker_side")

        if time_diff <= window_minutes and same_direction:
            current_cluster.append(current)
        else:
            if len(current_cluster) >= min_cluster_size:
                clusters.append(current_cluster)
            current_cluster = [current]

    if len(current_cluster) >= min_cluster_size:
        clusters.append(current_cluster)

    # Build window volumes for z-score baseline (15-min buckets across all trades)
    window_volumes: dict[str, float] = defaultdict(float)
    for trade in sorted_trades:
        ct = trade.get("created_time", "")
        if not ct:
            continue
        bucket = ct[:13] + ("a" if int(ct[14:16] or 0) < 30 else "b")
        price = int(trade.get("yes_price", 0) or trade.get("no_price", 0) or 0)
        window_volumes[bucket] += float(trade.get("count", 0) or 0) * price / 100
    all_window_vols = list(window_volumes.values())

    anomalies: list[dict[str, Any]] = []
    for cluster in clusters:
        direction = cluster[0].get("taker_side")
        prices = []
        for trade in cluster:
            if direction == "no":
                prices.append(int(trade.get("no_price", 0) or float(trade.get("no_price_dollars", "0")) * 100))
            else:
                prices.append(int(trade.get("yes_price", 0) or float(trade.get("yes_price_dollars", "0")) * 100))

        total_volume = sum(
            float(trade.get("count", trade.get("count_fp", 0)) or 0) * price / 100
            for trade, price in zip(cluster, prices)
        )
        if total_volume < min_total_volume:
            continue
        hours_before = None
        if market.get("close_time"):
            close_time = datetime.fromisoformat(market["close_time"].replace("Z", "+00:00"))
            cluster_start = datetime.fromisoformat(cluster[0]["created_time"].replace("Z", "+00:00"))
            hours_before = round((close_time - cluster_start).total_seconds() / 3600, 1)

        # Z-score: how many std devs above mean window volume is this cluster?
        z_score = 0.0
        if len(all_window_vols) >= 2:
            try:
                mean_v = statistics.mean(all_window_vols)
                std_v = statistics.stdev(all_window_vols)
                if std_v > 0:
                    z_score = round((total_volume - mean_v) / std_v, 2)
            except Exception:
                pass

        anomalies.append(
            {
                "anomaly_id": str(uuid.uuid4()),
                "anomaly_type": "coordinated",
                "ticker": market["ticker"],
                "market_title": market.get("title", ""),
                "severity": "HIGH" if total_volume >= 2500 else "MEDIUM",
                "trade_count": len(cluster),
                "total_volume": round(total_volume, 2),
                "hours_before_resolution": hours_before,
                "pre_trade_prob": min(prices) if prices else None,
                "resolution": market.get("result"),
                "z_score": z_score,
                "cluster_direction": direction,
                "cluster_start": cluster[0]["created_time"],
                "cluster_end": cluster[-1]["created_time"],
                "detected_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        )

    return anomalies
