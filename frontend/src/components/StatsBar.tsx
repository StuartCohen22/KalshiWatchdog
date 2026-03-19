import { useEffect, useState } from "react";
import CountUp from "react-countup";

import { getStats } from "../api/client";
import type { DashboardStats } from "../types";

const defaultStats: DashboardStats = {
  trades_ingested: 0,
  markets_monitored: 0,
  anomalies_flagged: 0,
  critical_alerts: 0,
  detection_rate: 0,
};

const labels: Array<[keyof DashboardStats, string]> = [
  ["trades_ingested", "Trades ingested"],
  ["markets_monitored", "Markets monitored"],
  ["anomalies_flagged", "Anomalies flagged"],
  ["critical_alerts", "Critical alerts"],
  ["detection_rate", "Detection rate"],
];

const POLL_INTERVAL_MS = 60_000;

export function StatsBar({ refreshToken = 0 }: { refreshToken?: number }) {
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [error, setError] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    let active = true;

    function doFetch() {
      getStats()
        .then((data) => {
          if (active) {
            setStats(data);
            setError(false);
            setJustUpdated(true);
            setTimeout(() => {
              if (active) setJustUpdated(false);
            }, 3000);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    }

    doFetch();
    const timer = setInterval(doFetch, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshToken]);

  return (
    <section className="panel">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">System status</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.14em] text-text-primary">
            Market surveillance console
          </h2>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border-default px-3 py-1">
          {!error && <span className="live-dot" />}
          <span className="text-xs uppercase tracking-[0.18em] text-text-secondary">
            {error ? "API unavailable" : justUpdated ? "updated" : "live"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {labels.map(([key, label]) => (
          <div key={key} className="rounded-2xl border border-border-default bg-bg-secondary px-4 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-text-tertiary">{label}</p>
            <div className="mt-3 flex items-end gap-2">
              <CountUp
                key={`${key}-${refreshToken}`}
                end={Number(stats[key])}
                duration={0.8}
                separator=","
                suffix={key === "detection_rate" ? "%" : ""}
                className="font-mono text-3xl font-semibold text-text-primary"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
