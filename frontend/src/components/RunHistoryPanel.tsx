import { useEffect, useState } from "react";

import { getRunHistory } from "../api/client";
import type { RunRecord } from "../api/client";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const profileColor: Record<string, string> = {
  demo: "text-[var(--severity-medium)]",
  strict: "text-[var(--accent)]",
};

export function RunHistoryPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getRunHistory(10)
      .then((data) => {
        if (active) setRuns(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  return (
    <div className="panel">
      <div className="mb-4">
        <p className="eyebrow">Pipeline audit</p>
        <h2 className="font-mono text-base font-semibold uppercase tracking-[0.12em] text-text-primary">
          Run history
        </h2>
      </div>

      {loading ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-text-secondary">
          No detection runs yet. Use the pipeline controls to run detection.
        </p>
      ) : (
        <div className="space-y-2">
          {runs.map((run, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-xl border border-border-default bg-bg-secondary px-3 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <span className="text-text-tertiary">{relativeTime(run.ran_at)}</span>
                <span className={`ml-2 uppercase tracking-[0.1em] ${profileColor[run.detection_profile] ?? "text-text-secondary"}`}>
                  {run.detection_profile}
                </span>
              </div>
              <div className="flex shrink-0 gap-3 font-mono text-text-secondary">
                <span>
                  <span className="text-text-primary">{run.anomalies_found}</span> anomalies
                </span>
                <span>
                  <span className="text-text-primary">{run.processed_markets}</span> mkts
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
