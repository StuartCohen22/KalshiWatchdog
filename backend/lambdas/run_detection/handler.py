from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any
import uuid

from backend.detection import (
    detect_coordinated_activity,
    detect_golden_window,
    detect_volume_spikes,
)
from backend.utils.bedrock import analyze_anomaly as analyze_anomaly_with_bedrock
from backend.utils.dynamo import (
    append_run_history,
    get_market,
    get_recent_settled_markets_with_trades,
    get_settled_markets,
    get_trades_for_market,
    get_traded_tickers,
    update_anomaly_analysis,
    write_anomaly,
)


def _demo_candidate_anomaly(trades: list[dict[str, Any]], market: dict[str, Any]) -> dict[str, Any] | None:
    if market.get("status") not in ("settled", "finalized") or not market.get("result") or not trades:
        return None

    winning_side = market["result"]
    close_time = datetime.fromisoformat(market["close_time"].replace("Z", "+00:00"))
    candidates: list[dict[str, Any]] = []

    for trade in trades:
        created_time = trade.get("created_time")
        if not created_time:
            continue
        trade_time = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
        hours_before = (close_time - trade_time).total_seconds() / 3600
        if hours_before <= 0 or hours_before > 168:
            continue
        if trade.get("taker_side") != winning_side:
            continue

        price_cents = int(trade.get("yes_price" if winning_side == "yes" else "no_price", 0) or 0)
        if price_cents <= 0:
            continue

        count = float(trade.get("count", 0) or 0)
        volume = count * price_cents / 100
        suspiciousness = ((100 - price_cents) / 100) * max(volume, 1) / max(hours_before, 1)
        candidates.append(
            {
                "trade_id": trade.get("trade_id"),
                "price_cents": price_cents,
                "count": int(count),
                "hours_before": round(hours_before, 1),
                "volume": round(volume, 2),
                "suspiciousness": suspiciousness,
                "created_time": created_time,
            }
        )

    if not candidates:
        return None

    ranked = sorted(candidates, key=lambda item: item["suspiciousness"], reverse=True)
    top = ranked[: min(5, len(ranked))]
    total_volume = sum(item["volume"] for item in top)
    if total_volume < 100:
        return None

    min_probability = min(item["price_cents"] for item in top)
    min_hours = min(item["hours_before"] for item in top)
    severity = "MEDIUM" if min_probability <= 35 and min_hours <= 72 else "LOW"

    return {
        "anomaly_id": str(uuid.uuid4()),
        "anomaly_type": "golden_window",
        "ticker": market["ticker"],
        "market_title": market.get("title", ""),
        "severity": severity,
        "trade_count": len(top),
        "total_volume": round(total_volume, 2),
        "hours_before_resolution": min_hours,
        "pre_trade_prob": min_probability,
        "resolution": winning_side,
        "z_score": round(sum(c["suspiciousness"] for c in top) / max(len(top), 1), 2),
        "flagged_trades": top,
        "candidate_only": True,
        "detected_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    market_limit = int(payload.get("limit", 20))
    analyze_with_llm = bool(payload.get("analyze_with_llm", False))
    detection_profile = payload.get("detection_profile", os.getenv("DETECTION_PROFILE", "demo"))

    if detection_profile == "demo":
        volume_sigma = 2.0
        volume_window_hours = 72
        golden_prob = 45
        golden_hours = 168
        golden_min_volume = 150
        coordinated_window = 15
        coordinated_cluster_size = 3
        coordinated_min_volume = 500
    else:
        volume_sigma = 3.0
        volume_window_hours = 24
        golden_prob = 20
        golden_hours = 48
        golden_min_volume = 0
        coordinated_window = 5
        coordinated_cluster_size = 3
        coordinated_min_volume = 0

    markets = get_recent_settled_markets_with_trades(limit=market_limit)
    selection_reason = "settled_markets_with_stored_trades"
    if not markets:
        markets = get_settled_markets(limit=market_limit)
        selection_reason = "recent_settled_markets_fallback"

    anomalies_found = 0
    processed_markets = 0
    summary: list[dict[str, Any]] = []

    for market in markets:
        ticker = market["ticker"]
        trades = get_trades_for_market(ticker)
        if not trades:
            continue

        processed_markets += 1
        anomalies = []
        anomalies.extend(
            detect_volume_spikes(
                trades,
                market,
                threshold_sigma=volume_sigma,
                final_window_hours=volume_window_hours,
            )
        )

        golden_window = detect_golden_window(
            trades,
            market,
            prob_threshold=golden_prob,
            hours_threshold=golden_hours,
            min_total_volume=golden_min_volume,
        )
        if golden_window:
            anomalies.append(golden_window)

        anomalies.extend(
            detect_coordinated_activity(
                trades,
                market,
                window_minutes=coordinated_window,
                min_cluster_size=coordinated_cluster_size,
                min_total_volume=coordinated_min_volume,
            )
        )

        if not anomalies and detection_profile == "demo":
            candidate = _demo_candidate_anomaly(trades, market)
            if candidate:
                anomalies.append(candidate)

        for anomaly in anomalies:
            anomaly["anomaly_key"] = ":".join(
                [
                    str(anomaly.get("ticker", "")),
                    str(anomaly.get("anomaly_type", "")),
                    str(
                        anomaly.get("anomaly_hour")
                        or anomaly.get("cluster_start")
                        or anomaly.get("hours_before_resolution")
                        or anomaly.get("pre_trade_prob")
                        or "base"
                    ),
                ]
            )
            write_anomaly(anomaly)
            anomalies_found += 1

            if analyze_with_llm:
                market_record = get_market(anomaly["ticker"]) or market
                analysis = analyze_anomaly_with_bedrock(anomaly, market_record)
                update_anomaly_analysis(
                    anomaly_id=anomaly["anomaly_id"],
                    summary=analysis.get("summary", ""),
                    reasoning=analysis.get("reasoning", ""),
                    severity=analysis.get("severity", anomaly.get("severity", "MEDIUM")),
                    explanations=analysis.get("explanations", []),
                )

        if anomalies:
            summary.append(
                {
                    "ticker": ticker,
                    "market_title": market.get("title", ""),
                    "anomalies": len(anomalies),
                }
            )

    run_record = {
        "ran_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "processed_markets": processed_markets,
        "anomalies_found": anomalies_found,
        "candidate_markets": len(markets),
        "stored_trade_tickers": len(get_traded_tickers()),
        "detection_profile": detection_profile,
        "selection_reason": selection_reason,
    }
    try:
        append_run_history(run_record)
    except Exception:
        pass

    return {
        "statusCode": 200,
        **run_record,
        "summary": summary,
        "message": (
            "No settled markets with stored trades were available for scoring."
            if processed_markets == 0
            else "Detection run completed."
        ),
    }
