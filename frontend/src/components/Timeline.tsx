import type { AnomalyRecord, MarketRecord, TradeRecord } from "../types";

function compactDate(value?: string) {
  if (!value) {
    return "Unknown";
  }
  return new Date(value).toLocaleString();
}

export function Timeline({
  anomaly,
  market,
  trades,
}: {
  anomaly: AnomalyRecord;
  market: MarketRecord | null;
  trades: TradeRecord[];
}) {
  const items = [
    {
      label: "Market opened",
      timestamp: market?.open_time,
      detail: market?.subtitle || "Kalshi opened trading on this contract.",
    },
    {
      label: "Suspicious pattern flagged",
      timestamp: anomaly.detected_at,
      detail:
        anomaly.llm_reasoning ||
        `${(anomaly.anomaly_type ?? "unknown").replace(/_/g, " ")} triggered after ${anomaly.trade_count ?? 0} trades.`,
    },
    {
      label: "Resolution window",
      timestamp: market?.close_time,
      detail: market?.result ? `Market resolved ${market.result.toUpperCase()}.` : "Resolution pending.",
    },
    {
      label: "Trade sample",
      timestamp: trades[0]?.created_time,
      detail:
        trades.length > 0
          ? `${trades.length} trades returned for this market from the API layer.`
          : "No trades returned by the backend.",
    },
  ].filter((item) => item.timestamp || item.detail);

  return (
    <div className="panel">
      <div className="mb-5">
        <p className="eyebrow">Case timeline</p>
        <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
          Sequence of activity
        </h2>
      </div>

      <div className="space-y-5">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="flex gap-4">
            <div className="mt-1 flex flex-col items-center">
              <span className="h-3 w-3 rounded-full bg-[var(--accent)]" />
              {index < items.length - 1 ? <span className="mt-2 h-full w-px bg-border-default" /> : null}
            </div>
            <div className="pb-4">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-text-tertiary">{item.label}</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{compactDate(item.timestamp)}</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

