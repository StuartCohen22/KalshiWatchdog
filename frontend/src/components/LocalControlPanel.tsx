import { useEffect, useState } from "react";

import {
  getRunHistory,
  getStorageStatus,
  ingestLocalMarkets,
  ingestLocalTrades,
  resetAnomalies,
  runLocalDetection,
} from "../api/client";
// ingestLocalMarkets, ingestLocalTrades, runLocalDetection kept for runFullPipeline
import type { RunRecord } from "../api/client";
import type { LocalActionResult, LocalStorageStatus } from "../types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STEPS = [
  "Ingesting settled markets…",
  "Ingesting full trade history…",
  "Running detection + Claude…",
];

export function LocalControlPanel({ onPipelineChange }: { onPipelineChange?: () => void }) {
  const [status, setStatus] = useState<LocalStorageStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fullHistory, setFullHistory] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0); // 0=idle, 1/2/3=running

  useEffect(() => {
    getStorageStatus().then(setStatus).catch(() => undefined);
    getRunHistory(8).then(setRuns).catch(() => undefined);
  }, []);

  async function refreshMeta() {
    const [latestStatus, latestRuns] = await Promise.all([
      getStorageStatus(),
      getRunHistory(8),
    ]);
    setStatus(latestStatus);
    setRuns(latestRuns);
    onPipelineChange?.();
  }

  async function runAction(
    label: string,
    action: () => Promise<LocalActionResult | { backend: string; local_data_dir: string }>,
    format: (result: LocalActionResult | { backend: string; local_data_dir: string }) => string,
  ) {
    setBusy(label);
    setMessage(null);
    try {
      const result = await action();
      setMessage(format(result));
      await refreshMeta();
    } catch {
      setMessage(`${label} failed. Check the local API logs.`);
    } finally {
      setBusy(null);
    }
  }

  async function runFullPipeline() {
    setBusy("pipeline");
    setMessage(null);
    let marketsIngested = 0;
    let tradesIngested = 0;
    let anomaliesFound = 0;
    let marketsScored = 0;

    try {
      // Step 1: ingest settled markets
      setPipelineStep(1);
      const marketsResult = await ingestLocalMarkets("settled", 720, 200);
      marketsIngested = "ingested" in marketsResult ? (marketsResult.ingested ?? 0) : 0;

      // Step 2: ingest full trade history
      setPipelineStep(2);
      const tradesResult = await ingestLocalTrades(720, undefined, {
        settledOnly: true,
        marketLimit: 50,
        allHistory: true,
        force: true,
      });
      tradesIngested = "ingested" in tradesResult ? (tradesResult.ingested ?? 0) : 0;

      // Step 3: run detection + Claude
      setPipelineStep(3);
      const detectionResult = await runLocalDetection(50, true);
      anomaliesFound = "anomalies_found" in detectionResult ? (detectionResult.anomalies_found ?? 0) : 0;
      marketsScored = "processed_markets" in detectionResult ? (detectionResult.processed_markets ?? 0) : 0;

      setMessage(
        `Pipeline complete — ${marketsIngested} markets, ${tradesIngested} trades ingested, ` +
        `${anomaliesFound} anomalies across ${marketsScored} markets scored with Claude 3 Haiku.`,
      );
      await refreshMeta();
    } catch {
      setMessage("Pipeline failed at step " + pipelineStep + ". Check the local API logs.");
    } finally {
      setBusy(null);
      setPipelineStep(0);
    }
  }

  const isPipelineRunning = busy === "pipeline";
  const isAnyBusy = Boolean(busy);

  return (
    <div className="panel">
      <div className="mb-5">
        <p className="eyebrow">Local pipeline</p>
        <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
          Ingest, detect, analyze
        </h2>
      </div>

      <div className="rounded-[20px] border border-border-default bg-bg-secondary p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-text-secondary">Storage backend</span>
          <span className="font-mono text-text-primary">{status?.backend ?? "unknown"}</span>
        </div>
        <div className="mt-2 flex justify-between gap-4">
          <span className="text-text-secondary">Local data dir</span>
          <span className="truncate font-mono text-xs text-text-primary">{status?.local_data_dir ?? "n/a"}</span>
        </div>
      </div>

      {/* ── Full pipeline CTA ── */}
      <div className="mt-4">
        <button
          type="button"
          className="button-primary w-full"
          disabled={isAnyBusy}
          onClick={runFullPipeline}
        >
          {isPipelineRunning
            ? `Step ${pipelineStep}/3 — ${STEPS[pipelineStep - 1]}`
            : "Run full pipeline"}
        </button>

        {/* Step progress bar */}
        {isPipelineRunning && (
          <div className="mt-2 flex gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                  i + 1 < pipelineStep
                    ? "bg-[var(--accent)]"
                    : i + 1 === pipelineStep
                    ? "animate-pulse bg-[var(--accent)]"
                    : "bg-border-default"
                }`}
              />
            ))}
          </div>
        )}

        <p className="mt-2 text-xs text-text-tertiary">
          Ingest settled markets → full trade history → detect anomalies + Claude 3 Haiku
        </p>
      </div>

      {/* ── Advanced controls ── */}
      <div className="mt-5 border-t border-border-default pt-4">
        <p className="mb-3 text-xs uppercase tracking-[0.14em] text-text-tertiary">Advanced</p>
        <button
          type="button"
          className="button-secondary w-full"
          disabled={isAnyBusy}
          onClick={() =>
            runAction(
              "ResetAnomalies",
              () => resetAnomalies(),
              (r) => {
                const result = r as { anomalies_removed?: number };
                return `Cleared ${result.anomalies_removed ?? 0} anomalies. Trades and markets kept.`;
              },
            )
          }
        >
          {busy === "ResetAnomalies" ? "Clearing…" : "Clear anomalies"}
        </button>
        <p className="mt-2 text-xs text-text-tertiary">
          Removes flagged anomalies only — keeps all trade and market data so you can re-run detection without reseeding.
        </p>
      </div>

      {message && (
        <p className="mt-4 text-sm leading-6 text-text-secondary">{message}</p>
      )}

      {/* ── Run history ── */}
      <div className="mt-4 border-t border-border-default pt-4">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-xs uppercase tracking-[0.14em] text-text-tertiary transition hover:text-text-secondary"
        >
          <span>Run history</span>
          <span>{historyOpen ? "▲" : "▼"}</span>
        </button>

        {historyOpen && (
          <div className="mt-3 space-y-2">
            {runs.length === 0 ? (
              <p className="text-xs text-text-tertiary">No runs yet.</p>
            ) : (
              runs.map((run, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border-default bg-bg-secondary px-3 py-2 text-xs"
                >
                  <span className="text-text-tertiary">{relativeTime(run.ran_at)}</span>
                  <div className="flex gap-3 font-mono text-text-secondary">
                    <span><span className="text-text-primary">{run.anomalies_found}</span> anomalies</span>
                    <span><span className="text-text-primary">{run.processed_markets}</span> mkts</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
