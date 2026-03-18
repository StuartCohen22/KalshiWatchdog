import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { explainMarket, getAnomalies, getReconMarkets, scanMarket } from "../api/client";
import type { MarketExplanation } from "../api/client";
import type { AnomalyRecord, ReconMarket } from "../types";
import { MarketPriceChart } from "./MarketPriceChart";
import { OrderbookChart } from "./OrderbookChart";

const riskTone: Record<ReconMarket["risk_label"], string> = {
  heightened: "text-[var(--severity-critical)] border-[var(--severity-critical)]/25 bg-[var(--severity-critical-bg)]",
  watch: "text-[var(--severity-medium)] border-[var(--severity-medium)]/25 bg-[var(--severity-medium-bg)]",
  baseline: "text-text-secondary border-border-default bg-[rgba(15,23,42,0.55)]",
};

function compactTime(value?: string) {
  if (!value) return "n/a";
  const d = new Date(value);
  const diffMs = d.getTime() - Date.now();
  const diffH = diffMs / 3600000;
  if (diffH < 0) return new Date(value).toLocaleDateString();
  if (diffH < 1) return `${Math.round(diffH * 60)}m`;
  if (diffH < 24) return `${Math.round(diffH)}h`;
  return `${Math.round(diffH / 24)}d`;
}

function compactTicker(value: string) {
  return value.length > 32 ? `${value.slice(0, 18)}...${value.slice(-8)}` : value;
}

function formatMetric(value?: number, fallback = "n/a") {
  if (value === undefined || value === null || Number.isNaN(value)) return fallback;
  return Math.round(value).toLocaleString();
}

type ActivePanel = "chart" | "orderbook" | "explain" | null;

type ScanState = "idle" | "scanning" | "done" | "error";

function AnomalyBadge({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full border border-[#ff3b5c]/30 bg-[rgba(255,59,92,0.1)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#ff3b5c] transition hover:bg-[rgba(255,59,92,0.18)]"
    >
      {count} {count === 1 ? "flag" : "flags"}
    </button>
  );
}

function MarketCard({
  market,
  anomalyCount,
  anomalyId,
}: {
  market: ReconMarket;
  anomalyCount: number;
  anomalyId: string | null;
}) {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [explanation, setExplanation] = useState<MarketExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanResult, setScanResult] = useState<string | null>(null);

  function togglePanel(panel: ActivePanel) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function handleExplain() {
    if (activePanel === "explain") {
      togglePanel(null);
      setExplanation(null);
      return;
    }
    togglePanel("explain");
    if (!explanation) {
      setExplaining(true);
      explainMarket(market)
        .then(setExplanation)
        .catch(() => undefined)
        .finally(() => setExplaining(false));
    }
  }

  async function handleScan() {
    setScanState("scanning");
    setScanResult(null);
    try {
      const result = await scanMarket(market.ticker);
      const count = "ingested" in result ? (result.ingested ?? 0) : 0;
      setScanResult(`${count.toLocaleString()} trades ingested`);
      setScanState("done");
    } catch {
      setScanResult("Scan failed.");
      setScanState("error");
    }
  }

  const isScanning = scanState === "scanning";

  return (
    <article className="rounded-[22px] border border-border-default bg-bg-secondary p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold leading-6 text-text-primary">
            {market.display_title || market.title}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-text-tertiary">
            {market.display_context || compactTicker(market.ticker)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {anomalyCount > 0 && (
            <AnomalyBadge
              count={anomalyCount}
              onClick={() => anomalyId && navigate(`/anomalies/${anomalyId}`)}
            />
          )}
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] ${riskTone[market.risk_label]}`}>
            {market.risk_label}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-text-secondary md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary">
            {market.display_volume_label || "Activity"}
          </p>
          <p className="mt-1 font-mono text-text-primary">
            {(() => {
              const val = market.display_volume ?? market.volume;
              if (!val) return "—";
              const label = (market.display_volume_label ?? "").toLowerCase();
              if (label === "open interest") return `${formatMetric(val)} contracts`;
              return `$${formatMetric(val)}`;
            })()}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary">Implied odds</p>
          <p className="mt-1 font-mono text-text-primary">{formatMetric(market.implied_price ?? market.last_price, "0")}%</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary">Closes</p>
          <p className="mt-1 font-mono text-text-primary">{compactTime(market.close_time)}</p>
        </div>
      </div>

      {/* Bid-ask spread chip */}
      {market.yes_bid != null && market.yes_ask != null && market.yes_ask > market.yes_bid && (
        <div className="mt-2">
          <span className="text-xs text-text-tertiary">
            Spread: <span className="font-mono text-text-secondary">{market.yes_ask - market.yes_bid}¢</span>
            {market.yes_ask - market.yes_bid > 10 && (
              <span className="ml-2 text-[#fbbf24]">wide</span>
            )}
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="data-chip">{compactTicker(market.ticker)}</span>
        {market.status ? <span className="data-chip">{market.status}</span> : null}
        {market.yes_bid || market.yes_ask ? (
          <span className="data-chip">
            YES {formatMetric(market.yes_bid ?? market.yes_ask, "0")}–{formatMetric(market.yes_ask ?? market.yes_bid, "0")}
          </span>
        ) : null}
        {(market.volume ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => togglePanel("chart")}
            className={`data-chip cursor-pointer hover:border-[var(--accent)]/40 hover:text-[var(--accent)] ${activePanel === "chart" ? "border-[var(--accent)]/40 text-[var(--accent)]" : ""}`}
          >
            Price chart
          </button>
        )}
        {(market.yes_bid != null || market.yes_ask != null) && (
          <button
            type="button"
            onClick={() => togglePanel("orderbook")}
            className={`data-chip cursor-pointer hover:border-[var(--accent)]/40 hover:text-[var(--accent)] ${activePanel === "orderbook" ? "border-[var(--accent)]/40 text-[var(--accent)]" : ""}`}
          >
            Depth
          </button>
        )}
        <button
          type="button"
          onClick={handleExplain}
          disabled={explaining}
          className={`data-chip cursor-pointer hover:border-[var(--accent)]/40 hover:text-[var(--accent)] disabled:opacity-50 ${activePanel === "explain" ? "border-[var(--accent)]/40 text-[var(--accent)]" : ""}`}
        >
          {explaining ? "Analyzing…" : "Explain"}
        </button>

        {/* Scan button */}
        <button
          type="button"
          onClick={handleScan}
          disabled={isScanning}
          className={`data-chip cursor-pointer disabled:opacity-50 ${
            scanState === "done"
              ? "border-[var(--accent)]/40 text-[var(--accent)]"
              : scanState === "error"
              ? "border-[#ff3b5c]/40 text-[#ff3b5c]"
              : "hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
          }`}
        >
          {isScanning ? "Scanning…" : scanState === "done" ? "Scanned ✓" : "Scan trades"}
        </button>
      </div>

      {/* Scan result */}
      {scanResult && (
        <p className={`mt-2 text-xs ${scanState === "error" ? "text-[#ff3b5c]" : "text-text-tertiary"}`}>
          {scanResult}
          {scanState === "done" && (
            <> · <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => navigate(`/search?q=${encodeURIComponent(market.ticker)}`)}>view trades →</button></>
          )}
        </p>
      )}

      {activePanel === "chart" ? <MarketPriceChart ticker={market.ticker} onEmpty={() => setActivePanel(null)} /> : null}
      {activePanel === "orderbook" ? <OrderbookChart ticker={market.ticker} onEmpty={() => setActivePanel(null)} /> : null}

      {activePanel === "explain" ? (
        <div className="mt-4 border-t border-border-default pt-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary">AI analysis</p>
          {explaining ? (
            <p className="text-sm text-text-tertiary">Analyzing market…</p>
          ) : explanation ? (
            <>
              <p className="text-sm font-medium text-text-primary leading-6">{explanation.headline}</p>
              <p className="text-sm text-text-secondary leading-6">{explanation.context}</p>
              <p className="text-xs leading-5">
                <span className="uppercase tracking-[0.12em] text-text-tertiary">Watch for: </span>
                <span className="text-[var(--accent)]">{explanation.watch_for}</span>
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {market.historical_parallels.length > 0 ? (
        <div className="mt-4 border-t border-border-default pt-4">
          <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary">Historical parallels</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {market.historical_parallels.map((parallel) => (
              <span key={parallel.id} className="data-chip">
                {parallel.title} / {parallel.pattern}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function MarketReconPanel() {
  const [markets, setMarkets] = useState<ReconMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ticker -> [anomaly_id of top anomaly, count]
  const [anomalyMap, setAnomalyMap] = useState<Map<string, { count: number; topId: string }>>(new Map());

  useEffect(() => {
    let active = true;

    // Load markets + anomalies in parallel
    Promise.all([
      getReconMarkets("open", 8),
      getAnomalies(),
    ])
      .then(([reconData, anomalyData]) => {
        if (!active) return;
        setMarkets(reconData);

        // Build ticker -> {count, topId} map
        const map = new Map<string, { count: number; topId: string }>();
        for (const a of anomalyData as AnomalyRecord[]) {
          const existing = map.get(a.ticker);
          if (!existing) {
            map.set(a.ticker, { count: 1, topId: a.anomaly_id });
          } else {
            map.set(a.ticker, { count: existing.count + 1, topId: existing.topId });
          }
        }
        setAnomalyMap(map);
      })
      .catch(() => {
        if (active) setError("Kalshi recon unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return (
    <div className="panel flex flex-col h-[680px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Live market recon</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
            Kalshi watchlist
          </h2>
        </div>
        <span className="text-xs uppercase tracking-[0.16em] text-text-tertiary">
          {loading ? "syncing" : `${markets.length} markets`}
        </span>
      </div>

      {error ? <p className="text-sm text-text-secondary">{error}</p> : null}

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {markets.map((market) => {
          const entry = anomalyMap.get(market.ticker);
          return (
            <MarketCard
              key={market.ticker}
              market={market}
              anomalyCount={entry?.count ?? 0}
              anomalyId={entry?.topId ?? null}
            />
          );
        })}

        {!loading && markets.length === 0 && !error ? (
          <p className="text-sm text-text-secondary">No recon markets returned.</p>
        ) : null}
      </div>
    </div>
  );
}
