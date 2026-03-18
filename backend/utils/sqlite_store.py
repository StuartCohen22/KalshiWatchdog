from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from threading import Lock
from typing import Any

LOCAL_DATA_DIR = Path(os.getenv("LOCAL_DATA_DIR", Path(__file__).resolve().parents[2] / "local_data"))
DB_PATH = LOCAL_DATA_DIR / "watchdog.db"

_lock = Lock()
_conn: sqlite3.Connection | None = None

_SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        _init_schema(conn)
        _conn = conn
    return _conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS trades (
            trade_id       TEXT PRIMARY KEY,
            ticker         TEXT NOT NULL,
            created_time   TEXT,
            yes_price      INTEGER DEFAULT 0,
            no_price       INTEGER DEFAULT 0,
            count          REAL    DEFAULT 0,
            taker_side     TEXT,
            volume_dollars REAL    DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_trades_ticker  ON trades(ticker);
        CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(ticker, created_time);

        CREATE TABLE IF NOT EXISTS markets (
            ticker          TEXT PRIMARY KEY,
            event_ticker    TEXT,
            title           TEXT,
            status          TEXT,
            result          TEXT,
            close_time      TEXT,
            volume          REAL    DEFAULT 0,
            last_price      INTEGER DEFAULT 0,
            category        TEXT,
            subtitle        TEXT,
            open_time       TEXT,
            expiration_time TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
        CREATE INDEX IF NOT EXISTS idx_markets_close  ON markets(close_time);

        CREATE TABLE IF NOT EXISTS anomalies (
            anomaly_id   TEXT PRIMARY KEY,
            anomaly_key  TEXT,
            ticker       TEXT,
            severity     TEXT,
            anomaly_type TEXT,
            detected_at  TEXT,
            total_volume REAL DEFAULT 0,
            data         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
        CREATE INDEX IF NOT EXISTS idx_anomalies_detected ON anomalies(detected_at);

        CREATE TABLE IF NOT EXISTS run_history (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at TEXT NOT NULL,
            data   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS kalshi_cache (
            cache_key TEXT PRIMARY KEY,
            data      TEXT NOT NULL,
            cached_at REAL NOT NULL
        );
    """)
    conn.commit()


# ── Trades ────────────────────────────────────────────────────────────────────

def batch_write_trades(trades: list[dict[str, Any]]) -> int:
    if not trades:
        return 0
    conn = _get_conn()
    rows = [
        (
            t["trade_id"],
            t["ticker"],
            t.get("created_time"),
            int(t.get("yes_price", 0) or 0),
            int(t.get("no_price", 0) or 0),
            float(t.get("count", 0) or 0),
            t.get("taker_side", "yes"),
            float(t.get("volume_dollars", 0) or 0),
        )
        for t in trades
        if t.get("trade_id")
    ]
    with _lock:
        conn.executemany(
            """INSERT OR REPLACE INTO trades
               (trade_id, ticker, created_time, yes_price, no_price, count, taker_side, volume_dollars)
               VALUES (?,?,?,?,?,?,?,?)""",
            rows,
        )
        conn.commit()
    return len(rows)


def get_trades_for_market(ticker: str) -> list[dict[str, Any]]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM trades WHERE ticker = ? ORDER BY created_time",
        (ticker,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_traded_tickers() -> list[str]:
    conn = _get_conn()
    rows = conn.execute("SELECT DISTINCT ticker FROM trades").fetchall()
    return [r[0] for r in rows]


# ── Markets ───────────────────────────────────────────────────────────────────

def write_market(market: dict[str, Any]) -> None:
    conn = _get_conn()
    with _lock:
        conn.execute(
            """INSERT OR REPLACE INTO markets
               (ticker, event_ticker, title, status, result, close_time,
                volume, last_price, category, subtitle, open_time, expiration_time)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                market["ticker"],
                market.get("event_ticker"),
                market.get("title", ""),
                market.get("status"),
                market.get("result"),
                market.get("close_time"),
                float(market.get("volume", 0) or 0),
                int(market.get("last_price", 0) or 0),
                market.get("category", "unknown"),
                market.get("subtitle", ""),
                market.get("open_time"),
                market.get("expiration_time"),
            ),
        )
        conn.commit()


def get_market(ticker: str) -> dict[str, Any] | None:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM markets WHERE ticker = ?", (ticker,)).fetchone()
    return dict(row) if row else None


def get_settled_markets(limit: int = 25) -> list[dict[str, Any]]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM markets WHERE status IN ('settled','finalized') ORDER BY close_time DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_recent_settled_markets_with_trades(limit: int = 25) -> list[dict[str, Any]]:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT m.* FROM markets m
           WHERE m.status IN ('settled','finalized')
             AND EXISTS (SELECT 1 FROM trades t WHERE t.ticker = m.ticker)
           ORDER BY m.close_time DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def search_markets(q: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    conn = _get_conn()
    if q:
        pattern = f"%{q.lower()}%"
        rows = conn.execute(
            """SELECT * FROM markets
               WHERE lower(title) LIKE ? OR lower(ticker) LIKE ?
               ORDER BY volume DESC LIMIT ?""",
            (pattern, pattern, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM markets ORDER BY volume DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── Anomalies ─────────────────────────────────────────────────────────────────

def write_anomaly(anomaly: dict[str, Any]) -> None:
    conn = _get_conn()
    anomaly_key = anomaly.get("anomaly_key", anomaly["anomaly_id"])
    existing = conn.execute(
        "SELECT anomaly_id FROM anomalies WHERE anomaly_key = ?", (anomaly_key,)
    ).fetchone()
    record = dict(anomaly)
    if existing:
        # Preserve the stable anomaly_id so callers (e.g. SSE emitter) use the right ID
        anomaly["anomaly_id"] = existing["anomaly_id"]
        record["anomaly_id"] = existing["anomaly_id"]
    with _lock:
        conn.execute(
            """INSERT OR REPLACE INTO anomalies
               (anomaly_id, anomaly_key, ticker, severity, anomaly_type,
                detected_at, total_volume, data)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                record["anomaly_id"],
                anomaly_key,
                record.get("ticker"),
                record.get("severity"),
                record.get("anomaly_type"),
                record.get("detected_at"),
                float(record.get("total_volume", 0) or 0),
                json.dumps(record),
            ),
        )
        conn.commit()


def _deduplicate_anomalies(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for item in items:
        key = f"{item.get('ticker')}:{item.get('anomaly_type')}"
        existing = best.get(key)
        if existing is None:
            best[key] = item
        else:
            if _SEVERITY_RANK.get(item.get("severity", "LOW"), 3) < _SEVERITY_RANK.get(existing.get("severity", "LOW"), 3):
                best[key] = item
            elif float(item.get("total_volume", 0)) > float(existing.get("total_volume", 0)):
                best[key] = item
    return sorted(best.values(), key=lambda x: (
        _SEVERITY_RANK.get(x.get("severity", "LOW"), 3),
        -float(x.get("total_volume", 0)),
    ))


def get_anomalies(severity: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    conn = _get_conn()
    if severity:
        rows = conn.execute(
            "SELECT data FROM anomalies WHERE severity = ? ORDER BY detected_at DESC LIMIT ?",
            (severity, limit * 5),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT data FROM anomalies ORDER BY detected_at DESC LIMIT ?",
            (limit * 5,),
        ).fetchall()
    items = [json.loads(r[0]) for r in rows]
    return _deduplicate_anomalies(items)[:limit]


def get_anomaly(anomaly_id: str) -> dict[str, Any] | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT data FROM anomalies WHERE anomaly_id = ?", (anomaly_id,)
    ).fetchone()
    return json.loads(row[0]) if row else None


def update_anomaly_analysis(
    anomaly_id: str,
    summary: str,
    reasoning: str,
    severity: str,
    explanations: list[str] | None = None,
) -> dict[str, Any]:
    conn = _get_conn()
    row = conn.execute(
        "SELECT data FROM anomalies WHERE anomaly_id = ?", (anomaly_id,)
    ).fetchone()
    if not row:
        return {}
    record = json.loads(row[0])
    record["llm_summary"] = summary
    record["llm_reasoning"] = reasoning
    # Only upgrade severity — never let LLM re-analysis downgrade a seed-detected severity
    current_rank = _SEVERITY_RANK.get(record.get("severity", "LOW"), 3)
    new_rank = _SEVERITY_RANK.get(severity, 3)
    if new_rank < current_rank:
        record["severity"] = severity
        severity = severity
    else:
        severity = record["severity"]
    record["explanations"] = explanations or []
    with _lock:
        conn.execute(
            "UPDATE anomalies SET severity = ?, data = ? WHERE anomaly_id = ?",
            (severity, json.dumps(record), anomaly_id),
        )
        conn.commit()
    return record


# ── Stats ─────────────────────────────────────────────────────────────────────

def get_stats() -> dict[str, int]:
    conn = _get_conn()
    trades_count = conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    markets_count = conn.execute("SELECT COUNT(*) FROM markets").fetchone()[0]
    anomaly_rows = conn.execute("SELECT data FROM anomalies").fetchall()
    anomalies = [json.loads(r[0]) for r in anomaly_rows]
    critical_alerts = sum(1 for a in anomalies if a.get("severity") == "CRITICAL")
    flagged_tickers = len({a.get("ticker") for a in anomalies if a.get("ticker")})
    detection_rate = int((flagged_tickers / max(markets_count, 1)) * 100)
    return {
        "trades_ingested": trades_count,
        "markets_monitored": markets_count,
        "anomalies_flagged": len(anomalies),
        "critical_alerts": critical_alerts,
        "detection_rate": detection_rate,
    }


# ── Run history ───────────────────────────────────────────────────────────────

def append_run_history(run: dict[str, Any]) -> None:
    conn = _get_conn()
    with _lock:
        conn.execute(
            "INSERT INTO run_history (ran_at, data) VALUES (?,?)",
            (run.get("ran_at", ""), json.dumps(run)),
        )
        conn.execute(
            "DELETE FROM run_history WHERE id NOT IN "
            "(SELECT id FROM run_history ORDER BY id DESC LIMIT 50)"
        )
        conn.commit()


def get_run_history(limit: int = 20) -> list[dict[str, Any]]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT data FROM run_history ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    return [json.loads(r[0]) for r in rows]


# ── Kalshi cache ──────────────────────────────────────────────────────────────

def get_kalshi_cache(cache_key: str, ttl_seconds: float = 300) -> Any | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT data, cached_at FROM kalshi_cache WHERE cache_key = ?", (cache_key,)
    ).fetchone()
    if not row:
        return None
    if time.time() - row["cached_at"] > ttl_seconds:
        return None
    return json.loads(row["data"])


def set_kalshi_cache(cache_key: str, data: Any) -> None:
    conn = _get_conn()
    with _lock:
        conn.execute(
            "INSERT OR REPLACE INTO kalshi_cache (cache_key, data, cached_at) VALUES (?,?,?)",
            (cache_key, json.dumps(data), time.time()),
        )
        conn.commit()


# ── Reset / status ────────────────────────────────────────────────────────────

def reset_anomalies() -> dict[str, Any]:
    """Clear only anomalies — keeps all trades and markets intact."""
    conn = _get_conn()
    with _lock:
        count = conn.execute("SELECT COUNT(*) FROM anomalies").fetchone()[0]
        conn.execute("DELETE FROM anomalies")
        conn.commit()
    return {"backend": "sqlite", "cleared": "anomalies", "anomalies_removed": count}


def reset_store() -> dict[str, Any]:
    """Full reset — clears everything including trades and markets."""
    conn = _get_conn()
    with _lock:
        conn.executescript("""
            DELETE FROM trades;
            DELETE FROM markets;
            DELETE FROM anomalies;
        """)
        conn.commit()
    return {"backend": "sqlite", "db_path": str(DB_PATH), "local_data_dir": str(LOCAL_DATA_DIR)}


def storage_status() -> dict[str, Any]:
    return {
        "backend": "sqlite",
        "db_path": str(DB_PATH),
        "local_data_dir": str(LOCAL_DATA_DIR),
        "tables": {
            "trades": "trades",
            "markets": "markets",
            "anomalies": "anomalies",
        },
    }
