from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

# Add backend/ to sys.path so Lambda-style imports (utils.*, detection.*, lambdas.*)
# resolve correctly when running locally as `python -m backend.local_api`
_BACKEND_DIR = str(Path(__file__).resolve().parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from lambdas.api.handler import lambda_handler


def _normalize_query(query: str) -> dict[str, str]:
    parsed = parse_qs(query, keep_blank_values=False)
    return {key: values[-1] for key, values in parsed.items() if values}


_SSE_CORS_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Accel-Buffering": "no",
}


class LocalAPIHandler(BaseHTTPRequestHandler):
    server_version = "KalshiWatchdogAPI/1.0"

    def do_OPTIONS(self) -> None:
        self._handle_request()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/local/detection-stream":
            self._handle_detection_stream()
            return
        self._handle_request()

    def do_POST(self) -> None:
        self._handle_request()

    def do_DELETE(self) -> None:
        self._handle_request()

    def _handle_request(self) -> None:
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else None
        print(f"{self.command} {parsed.path}")

        event: dict[str, Any] = {
            "httpMethod": self.command,
            "path": parsed.path,
            "rawPath": parsed.path,
            "queryStringParameters": _normalize_query(parsed.query),
            "headers": dict(self.headers),
            "body": body,
        }

        response = lambda_handler(event, None)
        payload = response.get("body", "")
        payload_bytes = payload.encode("utf-8") if isinstance(payload, str) else json.dumps(payload).encode("utf-8")

        self.send_response(int(response.get("statusCode", 200)))
        for header, value in (response.get("headers") or {}).items():
            self.send_header(header, value)
        self.send_header("Content-Length", str(len(payload_bytes)))
        self.end_headers()
        self.wfile.write(payload_bytes)

    def _handle_detection_stream(self) -> None:
        """SSE endpoint: run detection and stream each anomaly as it's found."""
        import uuid
        from datetime import datetime, timezone

        print("GET /api/local/detection-stream (SSE)")

        self.send_response(200)
        for header, value in _SSE_CORS_HEADERS.items():
            self.send_header(header, value)
        self.end_headers()

        def send_event(event_type: str, data: dict) -> bool:
            msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
            try:
                self.wfile.write(msg.encode())
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError):
                return False

        try:
            from utils.dynamo import (
                append_run_history,
                get_recent_settled_markets_with_trades,
                get_settled_markets,
                get_traded_tickers,
                get_trades_for_market,
                write_anomaly,
            )
            from detection import (
                detect_coordinated_activity,
                detect_golden_window,
                detect_volume_spikes,
            )

            markets = get_recent_settled_markets_with_trades(limit=50)
            selection_reason = "settled_markets_with_stored_trades"
            if not markets:
                markets = get_settled_markets(limit=50)
                selection_reason = "recent_settled_markets_fallback"

            if not send_event("start", {"markets": len(markets), "selection_reason": selection_reason}):
                return

            anomalies_found = 0
            processed = 0

            for market in markets:
                ticker = market["ticker"]
                trades = get_trades_for_market(ticker)
                if not trades:
                    continue
                processed += 1

                batch: list[dict[str, Any]] = []
                batch.extend(detect_volume_spikes(trades, market, threshold_sigma=2.0, final_window_hours=72))
                gw = detect_golden_window(trades, market, prob_threshold=45, hours_threshold=168, min_total_volume=150)
                if gw:
                    batch.append(gw)
                batch.extend(detect_coordinated_activity(trades, market, window_minutes=15, min_cluster_size=3, min_total_volume=500))

                for anomaly in batch:
                    anomaly["anomaly_key"] = ":".join([
                        str(anomaly.get("ticker", "")),
                        str(anomaly.get("anomaly_type", "")),
                        str(
                            anomaly.get("anomaly_hour")
                            or anomaly.get("cluster_start")
                            or anomaly.get("hours_before_resolution")
                            or anomaly.get("pre_trade_prob")
                            or "base"
                        ),
                    ])
                    write_anomaly(anomaly)
                    anomalies_found += 1
                    if not send_event("anomaly", anomaly):
                        return

            try:
                append_run_history({
                    "ran_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "processed_markets": processed,
                    "anomalies_found": anomalies_found,
                    "candidate_markets": len(markets),
                    "stored_trade_tickers": len(get_traded_tickers()),
                    "detection_profile": "demo",
                    "selection_reason": selection_reason,
                })
            except Exception:
                pass

            send_event("done", {
                "anomalies_found": anomalies_found,
                "processed_markets": processed,
                "message": "Detection stream complete.",
            })

        except Exception as exc:
            send_event("error", {"message": str(exc)})

    def log_message(self, format: str, *args: object) -> None:
        return


def run() -> None:
    host = os.getenv("LOCAL_API_HOST", "127.0.0.1")
    port = int(os.getenv("LOCAL_API_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), LocalAPIHandler)
    print(f"Kalshi Watchdog local API listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
