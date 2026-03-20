from __future__ import annotations

import base64
from decimal import Decimal, InvalidOperation
import json
import os
import time
from typing import Any
from urllib.parse import urlencode

import urllib3

BASE_URL = os.getenv("KALSHI_BASE_URL", "https://api.elections.kalshi.com/trade-api/v2")
REQUEST_DELAY_SECONDS = float(os.getenv("KALSHI_REQUEST_DELAY_SECONDS", "0.3"))

_api_key = os.getenv("KALSHI_API_KEY", "")
_rsa_key_path = os.getenv("KALSHI_RSA_KEY_PATH", "")

# Load RSA private key once at startup — from file path or inline PEM env var
_rsa_key = None
_rsa_key_pem_env = os.getenv("KALSHI_RSA_KEY_PEM", "")
if _rsa_key_path:
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend
        with open(_rsa_key_path, "rb") as f:
            _rsa_key = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
    except Exception as exc:
        print(f"[kalshi_client] Warning: could not load RSA key from {_rsa_key_path}: {exc}")

if not _rsa_key and _rsa_key_pem_env:
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend
        import base64 as _b64

        pem_bytes = _rsa_key_pem_env.encode()
        # If the value looks base64-encoded (no PEM header), decode it first
        if not _rsa_key_pem_env.startswith("-----"):
            pem_bytes = _b64.b64decode(_rsa_key_pem_env)
        _rsa_key = serialization.load_pem_private_key(
            pem_bytes, password=None, backend=default_backend()
        )
    except Exception as exc:
        print(f"[kalshi_client] Warning: could not load RSA key from KALSHI_RSA_KEY_PEM env: {exc}")

http = urllib3.PoolManager(
    num_pools=4,
    headers={
        "Accept": "application/json",
        "User-Agent": "kalshi-watchdog/1.0",
    },
)


def _auth_headers(method: str, path: str) -> dict[str, str]:
    """Return Kalshi auth headers. Uses RSA signing if key is loaded, else Bearer token."""
    if not _api_key:
        return {}
    ts_ms = str(int(time.time() * 1000))
    if _rsa_key:
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import padding
            msg = (ts_ms + method.upper() + path).encode()
            sig = _rsa_key.sign(msg, padding.PKCS1v15(), hashes.SHA256())
            sig_b64 = base64.b64encode(sig).decode()
            return {
                "KALSHI-ACCESS-KEY": _api_key,
                "KALSHI-ACCESS-TIMESTAMP": ts_ms,
                "KALSHI-ACCESS-SIGNATURE": sig_b64,
            }
        except Exception:
            pass
    # Fallback: Bearer token (works for some public endpoints)
    return {"Authorization": f"Bearer {_api_key}"}


def _price_to_cents(value: str | int | float | None) -> int:
    if value in (None, ""):
        return 0
    try:
        return int((Decimal(str(value)) * 100).quantize(Decimal("1")))
    except (InvalidOperation, ValueError):
        return 0


def _safe_float(value: str | int | float | None) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _request(path: str, params: dict[str, Any] | None = None, _retries: int = 3) -> dict[str, Any]:
    query = urlencode({key: value for key, value in (params or {}).items() if value not in (None, "")})
    url = f"{BASE_URL}{path}"
    if query:
        url = f"{url}?{query}"

    for attempt in range(_retries):
        headers = _auth_headers("GET", path)
        response = http.request("GET", url, headers=headers)
        if response.status == 429:
            backoff = 1.5 ** attempt
            time.sleep(backoff)
            continue
        if response.status >= 400:
            raise RuntimeError(f"Kalshi API request failed ({response.status}) for {url}")
        time.sleep(REQUEST_DELAY_SECONDS)
        return json.loads(response.data.decode("utf-8"))

    raise RuntimeError(f"Kalshi API rate-limited after {_retries} retries for {url}")


def _normalize_market(market: dict[str, Any]) -> dict[str, Any]:
    yes_bid = _price_to_cents(market.get("yes_bid_dollars"))
    yes_ask = _price_to_cents(market.get("yes_ask_dollars"))
    no_bid = _price_to_cents(market.get("no_bid_dollars"))
    no_ask = _price_to_cents(market.get("no_ask_dollars"))
    last_price = _price_to_cents(market.get("last_price_dollars"))
    volume = _safe_float(market.get("volume_fp"))
    volume_24h = _safe_float(market.get("volume_24h_fp"))
    open_interest = _safe_float(market.get("open_interest_fp"))
    liquidity_dollars = _safe_float(market.get("liquidity_dollars"))

    implied_price = 0
    if last_price:
        implied_price = last_price
    elif yes_bid and yes_ask:
        implied_price = int(round((yes_bid + yes_ask) / 2))
    elif yes_bid:
        implied_price = yes_bid
    elif yes_ask:
        implied_price = yes_ask
    elif no_bid:
        implied_price = 100 - no_bid
    elif no_ask:
        implied_price = 100 - no_ask

    display_volume = volume_24h or volume or liquidity_dollars or open_interest
    if volume_24h:
        display_volume_label = "24h volume"
    elif volume:
        display_volume_label = "lifetime volume"
    elif liquidity_dollars:
        display_volume_label = "liquidity"
    else:
        display_volume_label = "open interest"

    return {
        "ticker": market.get("ticker"),
        "event_ticker": market.get("event_ticker"),
        "market_type": market.get("market_type"),
        "title": market.get("title", ""),
        "subtitle": market.get("subtitle", ""),
        "yes_sub_title": market.get("yes_sub_title"),
        "no_sub_title": market.get("no_sub_title"),
        "created_time": market.get("created_time"),
        "open_time": market.get("open_time"),
        "close_time": market.get("close_time"),
        "expiration_time": market.get("expiration_time"),
        "status": market.get("status"),
        "result": market.get("result"),
        "yes_bid": yes_bid,
        "yes_ask": yes_ask,
        "no_bid": no_bid,
        "no_ask": no_ask,
        "last_price": last_price,
        "implied_price": implied_price,
        "volume": volume,
        "volume_24h": volume_24h,
        "display_volume": display_volume,
        "display_volume_label": display_volume_label,
        "open_interest": open_interest,
        "liquidity_dollars": liquidity_dollars,
        "category": (market.get("event_ticker") or market.get("ticker") or "").split("-")[0],
    }


def _normalize_trade(trade: dict[str, Any]) -> dict[str, Any]:
    yes_price = _price_to_cents(trade.get("yes_price_dollars"))
    no_price = _price_to_cents(trade.get("no_price_dollars"))
    count = _safe_float(trade.get("count_fp"))
    side = trade.get("taker_side") or "yes"
    price_cents = yes_price if side == "yes" else no_price

    return {
        "trade_id": trade.get("trade_id"),
        "ticker": trade.get("ticker"),
        "created_time": trade.get("created_time"),
        "count": count,
        "yes_price": yes_price,
        "no_price": no_price,
        "taker_side": side,
        "volume_dollars": round(count * price_cents / 100, 2),
    }


def fetch_markets(
    status: str | None = None,
    limit: int = 1000,
    cursor: str | None = None,
    **filters: Any,
) -> list[dict[str, Any]]:
    markets: list[dict[str, Any]] = []
    next_cursor = cursor or ""
    remaining = max(limit, 0)

    while True:
        page_limit = min(remaining if remaining else 1000, 1000)
        params = {"limit": page_limit}
        if status:
            params["status"] = status
        if next_cursor:
            params["cursor"] = next_cursor
        for key, value in filters.items():
            if value not in (None, ""):
                params[key] = value

        payload = _request("/markets", params)
        batch = [_normalize_market(market) for market in payload.get("markets", [])]
        markets.extend(batch)
        if remaining:
            remaining = max(remaining - len(batch), 0)
        next_cursor = payload.get("cursor", "")
        if not next_cursor or remaining == 0:
            break

    return markets


def fetch_trades(
    ticker: str | None = None,
    min_ts: int | None = None,
    max_ts: int | None = None,
    limit: int = 1000,
    cursor: str | None = None,
) -> list[dict[str, Any]]:
    trades: list[dict[str, Any]] = []
    next_cursor = cursor or ""
    remaining = max(limit, 0)

    while True:
        page_limit = min(remaining if remaining else 1000, 1000)
        params = {"limit": page_limit}
        if next_cursor:
            params["cursor"] = next_cursor
        if ticker:
            params["ticker"] = ticker
        if min_ts:
            params["min_ts"] = min_ts
        if max_ts:
            params["max_ts"] = max_ts

        payload = _request("/markets/trades", params)
        batch = [_normalize_trade(trade) for trade in payload.get("trades", [])]
        trades.extend(batch)
        if remaining:
            remaining = max(remaining - len(batch), 0)
        next_cursor = payload.get("cursor", "")
        if not next_cursor or remaining == 0:
            break

    return trades


def fetch_all_trades(ticker: str | None = None) -> list[dict[str, Any]]:
    return fetch_trades(ticker=ticker)


def fetch_orderbook(ticker: str) -> dict[str, Any]:
    return _request(f"/markets/{ticker}/orderbook")


def fetch_candlesticks(
    ticker: str,
    start_ts: int,
    end_ts: int,
    period_interval: int,
) -> dict[str, Any]:
    series_ticker = ticker.split("-")[0]
    return _request(
        f"/series/{series_ticker}/markets/{ticker}/candlesticks",
        {
            "start_ts": start_ts,
            "end_ts": end_ts,
            "period_interval": period_interval,
        },
    )


def fetch_events(
    limit: int = 50,
    cursor: str | None = None,
    series_ticker: str | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    next_cursor = cursor or ""
    remaining = max(limit, 0)

    while True:
        page_limit = min(remaining if remaining else 100, 100)
        params: dict[str, Any] = {"limit": page_limit}
        if next_cursor:
            params["cursor"] = next_cursor
        if series_ticker:
            params["series_ticker"] = series_ticker
        if category:
            params["category"] = category

        payload = _request("/events", params)
        batch = payload.get("events", [])
        events.extend(batch)
        if remaining:
            remaining = max(remaining - len(batch), 0)
        next_cursor = payload.get("cursor", "")
        if not next_cursor or remaining == 0:
            break

    return events
