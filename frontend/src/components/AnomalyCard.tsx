import { Link } from "react-router-dom";

import type { AnomalyRecord } from "../types";
import { SeverityBadge } from "./SeverityBadge";

const accentBySeverity = {
  CRITICAL: "var(--severity-critical)",
  HIGH: "var(--severity-high)",
  MEDIUM: "var(--severity-medium)",
  LOW: "var(--text-tertiary)",
} as const;

function formatType(type: AnomalyRecord["anomaly_type"]) {
  return type.replace(/_/g, " ").toUpperCase();
}

export function AnomalyCard({ anomaly }: { anomaly: AnomalyRecord }) {
  return (
    <Link
      to={`/anomalies/${anomaly.anomaly_id}`}
      className="group block rounded-[22px] border border-border-default bg-bg-card p-5 shadow-panel transition duration-200 hover:border-border-accent hover:bg-bg-hover"
      style={{ borderLeft: `4px solid ${accentBySeverity[anomaly.severity]}` }}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Market</p>
          <h3 className="max-w-[28ch] text-lg font-semibold text-text-primary">{anomaly.market_title}</h3>
        </div>
        <SeverityBadge severity={anomaly.severity} />
      </div>

      <p className="text-sm leading-6 text-text-secondary">
        {anomaly.llm_summary ??
          (anomaly.candidate_only
            ? "Demo candidate generated from the strongest late winning-side signal in this market."
            : "Anomaly flagged before LLM review. Inspect volume, timing, and payout asymmetry.")}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <span className="data-chip">{formatType(anomaly.anomaly_type)}</span>
        <span className="data-chip">VOL ${Math.round(anomaly.total_volume).toLocaleString()}</span>
        {typeof anomaly.z_score === "number" && anomaly.z_score > 0 ? (
          <span className="data-chip">Z {anomaly.z_score.toFixed(2)}</span>
        ) : null}
        {typeof anomaly.pre_trade_prob === "number" ? (
          <span className="data-chip">ODDS {anomaly.pre_trade_prob}%</span>
        ) : null}
        {anomaly.candidate_only ? <span className="data-chip">DEMO CANDIDATE</span> : null}
      </div>
    </Link>
  );
}
