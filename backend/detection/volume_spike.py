from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

import numpy as np


def detect_volume_spikes(
    trades: list[dict[str, Any]],
    market: dict[str, Any],
    threshold_sigma: float = 3.0,
    final_window_hours: int = 24,
) -> list[dict[str, Any]]:
    if market.get("status") != "settled":
        return []

    hourly_volume: dict[str, float] = defaultdict(float)
    for trade in trades:
        created_time = trade.get("created_time")
        if not created_time:
            continue

        hour_key = created_time[:13]
        count = float(trade.get("count", trade.get("count_fp", 0)) or 0)
        if "yes_price" in trade:
            price_cents = int(trade.get("yes_price", 0) or 0)
        else:
            price_cents = int(float(trade.get("yes_price_dollars", "0")) * 100)

        hourly_volume[hour_key] += count * price_cents / 100

    if len(hourly_volume) < 5:
        return []

    volumes = list(hourly_volume.values())
    mean_vol = float(np.mean(volumes))
    std_vol = float(np.std(volumes))
    if std_vol == 0:
        return []

    close_time = datetime.fromisoformat(market["close_time"].replace("Z", "+00:00"))
    anomalies: list[dict[str, Any]] = []
    for hour_key, volume in hourly_volume.items():
        hour_time = datetime.fromisoformat(f"{hour_key}:00:00+00:00")
        z_score = (volume - mean_vol) / std_vol
        hours_before = (close_time - hour_time).total_seconds() / 3600

        if z_score > threshold_sigma and 0 < hours_before <= final_window_hours:
            anomalies.append(
                {
                    "anomaly_id": str(uuid.uuid4()),
                    "anomaly_type": "volume_spike",
                    "ticker": market["ticker"],
                    "market_title": market.get("title", ""),
                    "severity": "HIGH" if z_score > 4 else "MEDIUM",
                    "anomaly_hour": hour_time.isoformat().replace("+00:00", "Z"),
                    "z_score": round(z_score, 2),
                    "trade_count": sum(
                        1 for trade in trades if str(trade.get("created_time", ""))[:13] == hour_key
                    ),
                    "total_volume": round(volume, 2),
                    "hours_before_resolution": round(hours_before, 1),
                    "pre_trade_prob": None,
                    "resolution": market.get("result", ""),
                    "detected_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
            )

    return anomalies
