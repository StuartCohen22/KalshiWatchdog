import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { SeverityBadge } from "./SeverityBadge";
import type { AnomalyRecord } from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

type StreamState = "idle" | "running" | "done" | "error";

interface StreamStats {
  markets: number;
  anomaliesFound: number;
}

const TYPE_LABEL: Record<string, string> = {
  golden_window: "golden window",
  coordinated: "coordinated",
  volume_spike: "volume spike",
};

const TYPE_COLOR: Record<string, string> = {
  golden_window: "#ff3b5c",
  coordinated: "#ff8a4c",
  volume_spike: "#fbbf24",
};

export function LiveDetectionStream({ onComplete }: { onComplete?: () => void }) {
  const [state, setState] = useState<StreamState>("idle");
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [stats, setStats] = useState<StreamStats>({ markets: 0, anomaliesFound: 0 });
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const navigate = useNavigate();

  const startStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    setAnomalies([]);
    setError(null);
    setStats({ markets: 0, anomaliesFound: 0 });
    setState("running");

    const es = new EventSource(`${API_BASE_URL}/api/local/detection-stream`);
    esRef.current = es;

    es.addEventListener("start", (e) => {
      const data = JSON.parse(e.data);
      setStats((s) => ({ ...s, markets: data.markets ?? 0 }));
    });

    es.addEventListener("anomaly", (e) => {
      const anomaly = JSON.parse(e.data) as AnomalyRecord;
      setAnomalies((prev) => [anomaly, ...prev]);
      setStats((s) => ({ ...s, anomaliesFound: s.anomaliesFound + 1 }));
    });

    es.addEventListener("done", (e) => {
      const data = JSON.parse(e.data);
      setStats((s) => ({ ...s, anomaliesFound: data.anomalies_found ?? s.anomaliesFound }));
      setState("done");
      es.close();
      esRef.current = null;
      onComplete?.();
    });

    es.addEventListener("error", (e) => {
      const raw = (e as MessageEvent).data;
      if (raw) {
        try {
          setError(JSON.parse(raw).message ?? "Stream error");
        } catch {
          setError("Detection stream failed.");
        }
      } else {
        // Network error / server closed connection after done
        if (state !== "done") {
          setState("error");
          setError("Connection lost.");
        }
      }
      es.close();
      esRef.current = null;
    });
  }, [onComplete, state]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setState("idle");
  }, []);

  const isRunning = state === "running";

  return (
    <div className="panel">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Live detection</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
            Anomaly stream
          </h2>
          <p className="mt-1 text-xs text-text-tertiary">
            Stream anomalies in real time as detection runs across all stored markets.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {isRunning ? (
            <button type="button" className="button-secondary" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="button-primary" onClick={startStream}>
              {state === "done" ? "Run again" : "Start stream"}
            </button>
          )}

          {(isRunning || state === "done") && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              {isRunning && <span className="live-dot" />}
              <span className="font-mono">
                {stats.anomaliesFound} anomalies / {stats.markets} markets
              </span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-[#ff3b5c]/20 bg-[rgba(255,59,92,0.06)] px-4 py-3 text-sm text-[#ff3b5c]">
          {error}
        </p>
      )}

      {state === "idle" && anomalies.length === 0 && (
        <div className="flex h-[220px] items-center justify-center rounded-[20px] border border-dashed border-border-default">
          <p className="text-sm text-text-secondary">
            Press "Start stream" to run detection and watch anomalies appear live.
          </p>
        </div>
      )}

      {anomalies.length > 0 && (
        <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
          {anomalies.map((a, i) => (
            <button
              key={`${a.anomaly_id}-${i}`}
              type="button"
              onClick={() => navigate(`/anomalies/${a.anomaly_id}`)}
              className="w-full rounded-[16px] border border-border-default bg-bg-secondary px-4 py-3 text-left transition hover:border-border-accent"
              style={{
                animation: "fadeSlideIn 0.35s ease both",
                animationDelay: `${Math.min(i * 40, 300)}ms`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{a.market_title}</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    <span style={{ color: TYPE_COLOR[a.anomaly_type] ?? "#63dcbe" }}>
                      {TYPE_LABEL[a.anomaly_type] ?? a.anomaly_type}
                    </span>
                    {a.hours_before_resolution != null && (
                      <> · {Math.abs(a.hours_before_resolution).toFixed(1)}h before resolution</>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  {a.total_volume > 0 && (
                    <span className="font-mono text-xs text-text-tertiary">
                      ${Math.round(a.total_volume).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {state === "done" && anomalies.length === 0 && (
        <div className="rounded-[20px] border border-dashed border-border-default px-4 py-6 text-center text-sm text-text-secondary">
          No anomalies detected in this run.
        </div>
      )}
    </div>
  );
}
