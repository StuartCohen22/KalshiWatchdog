from __future__ import annotations

import json
import os
import re
from typing import Any

ANALYSIS_BACKEND = os.getenv("ANALYSIS_BACKEND", "bedrock").lower()
DEFAULT_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")
DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")


def _prompt(anomaly_data: dict[str, Any], market_data: dict[str, Any]) -> str:
    return f"""You are a financial surveillance analyst examining prediction market
trading data from Kalshi, a CFTC-regulated exchange.

Analyze this flagged trading anomaly and respond ONLY with valid JSON.

## Anomaly Data
- Market: {market_data.get('title', 'Unknown')}
- Market Result: Resolved {anomaly_data.get('resolution', 'N/A')}
- Anomaly Type: {anomaly_data['anomaly_type']}
- Trades Flagged: {anomaly_data.get('trade_count', 'N/A')}
- Total Volume: ${anomaly_data.get('total_volume', 'N/A')}
- Time Before Resolution: {anomaly_data.get('hours_before_resolution', 'N/A')}h
- Pre-Trade Probability: {anomaly_data.get('pre_trade_prob', 'N/A')}%
- Z-Score: {anomaly_data.get('z_score', 'N/A')}

## Respond with ONLY this JSON (no markdown, no backticks):
{{
  "summary": "2-3 sentence plain-English summary of what happened",
  "reasoning": "Why this pattern is statistically suspicious",
  "severity": "CRITICAL or HIGH or MEDIUM or LOW",
  "explanations": [
    "Possible innocent explanation",
    "Possible suspicious explanation"
  ]
}}

Severity guide:
- CRITICAL: z-score > 4 OR volume > $10K on sub-10% odds within 12h
- HIGH: z-score > 3 OR volume > $5K on sub-20% odds within 24h
- MEDIUM: z-score > 2.5 OR notable timing patterns
- LOW: Mildly unusual but could be noise"""


def _heuristic_analysis(anomaly_data: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
    z_score = float(anomaly_data.get("z_score", 0) or 0)
    volume = float(anomaly_data.get("total_volume", 0) or 0)
    probability = anomaly_data.get("pre_trade_prob")
    hours_before = float(anomaly_data.get("hours_before_resolution", 999) or 999)

    if z_score > 4 or (probability is not None and probability <= 10 and volume > 10000 and hours_before <= 12):
        severity = "CRITICAL"
    elif z_score > 3 or (probability is not None and probability <= 20 and volume > 5000 and hours_before <= 24):
        severity = "HIGH"
    elif z_score > 2.5 or hours_before <= 48:
        severity = "MEDIUM"
    else:
        severity = "LOW"

    market_title = market_data.get("title", anomaly_data.get("market_title", "Unknown market"))
    anomaly_type = anomaly_data.get("anomaly_type", "pattern")
    summary = (
        f"{market_title} was flagged for {anomaly_type.replace('_', ' ')} activity. "
        f"The suspicious window involved {anomaly_data.get('trade_count', 'multiple')} trades totaling "
        f"about ${int(volume):,} with resolution leaning {anomaly_data.get('resolution', 'unknown')}."
    )
    reasoning = (
        f"The pattern stands out because it combined timing within {hours_before:g} hours of resolution, "
        f"pricing near {probability if probability is not None else 'unknown'}%, and a z-score of {z_score:.2f}. "
        "That mix suggests informed positioning rather than routine noise."
    )
    return {
        "summary": summary,
        "reasoning": reasoning,
        "severity": severity,
        "explanations": [
            "A real-world news leak or public rumor may have shifted prices before broad coverage.",
            "A trader may have acted on material non-public information shortly before resolution.",
        ],
    }


def _parse_json_response(text: str, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {
            "summary": text[:200],
            "reasoning": "LLM response parsing failed",
            "severity": fallback.get("severity", "MEDIUM"),
            "explanations": ["Unable to parse structured response"],
        }


def _analyze_with_bedrock(prompt: str, fallback: dict[str, Any]) -> dict[str, Any]:
    import boto3  # type: ignore

    bedrock = boto3.client("bedrock-runtime", region_name=DEFAULT_REGION)
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 500,
            "temperature": 0.3,
            "messages": [{"role": "user", "content": prompt}],
        }
    )
    response = bedrock.invoke_model(
        modelId=DEFAULT_MODEL_ID,
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(response["body"].read())
    text = payload["content"][0]["text"]
    return _parse_json_response(text, fallback)


def _market_explain_prompt(market_data: dict[str, Any]) -> str:
    title = market_data.get("title", "Unknown market")
    yes_sub = market_data.get("yes_sub_title", "")
    implied_price = market_data.get("implied_price", 0) or market_data.get("last_price", 0) or 0
    volume = market_data.get("display_volume", 0) or market_data.get("volume", 0) or 0
    close_time = market_data.get("close_time", "unknown")
    category = market_data.get("category", "unknown")

    subject = f"{title}" + (f" ({yes_sub})" if yes_sub else "")

    return f"""You are a prediction market analyst. Explain this Kalshi market in plain English for a general audience.

Market: {subject}
Current probability: {implied_price}%
24h volume: ${int(float(volume or 0)):,}
Category: {category}
Closes: {close_time}

Respond ONLY with valid JSON (no markdown, no backticks):
{{
  "headline": "One crisp sentence summarizing what this market is predicting",
  "context": "2-3 sentences: what drives this probability, what would move it, and why people trade it",
  "watch_for": "One sentence: the key catalyst to watch for resolution"
}}"""


def _heuristic_market_explain(market_data: dict[str, Any]) -> dict[str, Any]:
    title = market_data.get("title", "Unknown market")
    yes_sub = market_data.get("yes_sub_title", "")
    implied_price = int(market_data.get("implied_price", 0) or market_data.get("last_price", 0) or 0)
    subject = f"{title}" + (f" — {yes_sub}" if yes_sub else "")

    if implied_price >= 70:
        outlook = "heavily favored"
    elif implied_price >= 50:
        outlook = "slight favorite"
    elif implied_price >= 30:
        outlook = "moderate underdog"
    else:
        outlook = "significant underdog"

    return {
        "headline": f"{subject} is currently trading at {implied_price}% ({outlook}).",
        "context": (
            f"This market lets traders bet on whether {subject.lower()} will occur. "
            f"At {implied_price}%, the market crowd gives this a {outlook} probability. "
            "Prices shift as new information emerges or sentiment changes."
        ),
        "watch_for": "Monitor for breaking news or official announcements that could shift the probability.",
    }


def explain_market(market_data: dict[str, Any]) -> dict[str, Any]:
    prompt = _market_explain_prompt(market_data)
    fallback = _heuristic_market_explain(market_data)

    try:
        if ANALYSIS_BACKEND == "heuristic":
            return fallback
        return _analyze_with_bedrock(prompt, fallback)
    except Exception:
        return fallback


def analyze_anomaly(anomaly_data: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
    prompt = _prompt(anomaly_data, market_data)
    fallback = _heuristic_analysis(anomaly_data, market_data)

    try:
        if ANALYSIS_BACKEND == "heuristic":
            return fallback
        return _analyze_with_bedrock(prompt, fallback)
    except Exception:
        return fallback
