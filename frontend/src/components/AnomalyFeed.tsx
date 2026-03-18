import { useEffect, useState } from "react";

import { getAnomalies } from "../api/client";
import type { AnomalyRecord } from "../types";
import { AnomalyCard } from "./AnomalyCard";

const filters = ["ALL", "CRITICAL", "HIGH", "MEDIUM"] as const;
const PAGE_SIZE = 5;

export function AnomalyFeed({ refreshToken = 0 }: { refreshToken?: number }) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("ALL");
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Reset to first page when filter changes
  useEffect(() => {
    setPage(0);
  }, [filter]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getAnomalies(filter === "ALL" ? undefined : filter)
      .then((data) => {
        if (!active) return;
        setAnomalies(data);
        setPage(0);
      })
      .catch(() => {
        if (!active) return;
        setError("Backend unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter, refreshToken]);

  const totalPages = Math.max(1, Math.ceil(anomalies.length / PAGE_SIZE));
  const pageSlice = anomalies.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <aside className="panel flex flex-col h-[680px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Anomaly Feed</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
            Flagged markets
          </h2>
        </div>
        <span className="text-xs uppercase tracking-[0.16em] text-text-tertiary">
          {loading ? "syncing" : `${anomalies.length} records`}
        </span>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {filters.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.15em] transition ${
              filter === option
                ? "border-border-accent bg-[var(--accent-dim)] text-[var(--accent)]"
                : "border-border-default text-text-secondary hover:border-border-accent hover:text-text-primary"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {loading ? <div className="text-sm text-text-secondary">Loading anomaly feed…</div> : null}
      {error ? (
        <div className="rounded-2xl border border-border-default bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
          {error}. The UI is live, but it needs the API routes to return data.
        </div>
      ) : null}

      {!loading && !error && anomalies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-default px-4 py-6 text-sm text-text-secondary">
          No anomalies returned for this filter.
        </div>
      ) : null}

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
        {pageSlice.map((anomaly) => (
          <AnomalyCard key={anomaly.anomaly_id} anomaly={anomaly} />
        ))}
      </div>

      {/* Pagination controls */}
      {anomalies.length > PAGE_SIZE ? (
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border-default pt-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-full border border-border-default px-4 py-1.5 text-xs text-text-secondary transition hover:border-border-accent hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="font-mono text-xs text-text-tertiary">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-full border border-border-default px-4 py-1.5 text-xs text-text-secondary transition hover:border-border-accent hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      ) : null}
    </aside>
  );
}
