import { Link } from "react-router-dom";
import { motion } from "motion/react";

import type { AnomalyRecord } from "../types";
import { SeverityBadge } from "./SeverityBadge";

const accentBySeverity = {
  CRITICAL: "var(--severity-critical)",
  HIGH: "var(--severity-high)",
  MEDIUM: "var(--severity-medium)",
  LOW: "var(--text-tertiary)",
} as const;

function formatType(type: AnomalyRecord["anomaly_type"]) {
  return (type ?? "unknown").replace(/_/g, " ").toUpperCase();
}

function fallbackSummary(anomaly: AnomalyRecord): string {
  const vol = `$${Math.round(anomaly.total_volume).toLocaleString()}`;
  const z = typeof anomaly.z_score === "number" ? anomaly.z_score.toFixed(1) : null;
  const odds = typeof anomaly.pre_trade_prob === "number" ? `${anomaly.pre_trade_prob}¢` : null;

  if (anomaly.anomaly_type === "coordinated") {
    return `${vol} in coordinated burst activity detected${z ? ` (z=${z})` : ""}. Unusually tight clustering of trades in a short window suggests non-independent actors.`;
  }
  if (anomaly.anomaly_type === "golden_window") {
    return `${vol} placed on ${odds ? `a ${odds} outcome` : "an extreme-probability market"} shortly before resolution. High-notional bets on near-certain outcomes may indicate advance knowledge.`;
  }
  if (anomaly.anomaly_type === "volume_spike") {
    return `Volume spike of ${vol}${z ? ` (z=${z})` : ""} — well above this market's historical baseline. Unusual surge may precede a significant resolution event.`;
  }
  return "Anomaly flagged. Inspect volume, timing, and payout asymmetry for suspicious patterns.";
}

export function AnomalyCard({ anomaly }: { anomaly: AnomalyRecord }) {
  return (
    <motion.div whileHover={{ scale: 1.01, y: -1 }} transition={{ duration: 0.15 }}>
    <Link
      to={`/anomalies/${anomaly.anomaly_id}`}
      className="group block rounded-[22px] border border-border-default bg-bg-card p-5 shadow-panel transition duration-200 hover:border-border-accent hover:bg-bg-hover"
      style={{ borderLeft: `4px solid ${accentBySeverity[anomaly.severity] ?? "var(--text-tertiary)"}` }}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Market</p>
          <h3 className="max-w-[28ch] text-lg font-semibold text-text-primary">{anomaly.market_title}</h3>
        </div>
        <SeverityBadge severity={anomaly.severity} />
      </div>

      <p className="text-sm leading-6 text-text-secondary">
        {anomaly.llm_summary ?? fallbackSummary(anomaly)}
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
    </motion.div>
  );
}
