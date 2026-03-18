import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getAnomaly, getMarketTrades } from "../api/client";
import { PriceVolumeOverlay } from "../components/PriceVolumeOverlay";
import { SeverityBadge } from "../components/SeverityBadge";
import { Timeline } from "../components/Timeline";
import type { AnomalyDetailResponse, AnomalyRecord, MarketRecord, TradeRecord } from "../types";

// ─── Pattern explainer ────────────────────────────────────────────────────────

function patternSummary(anomaly: AnomalyRecord): { headline: string; detail: string } {
  const { anomaly_type, trade_count, cluster_direction, cluster_start, cluster_end,
    hours_before_resolution, pre_trade_prob, resolution, total_volume, z_score } = anomaly;

  const hrs = hours_before_resolution != null
    ? `${hours_before_resolution}h before resolution`
    : "shortly before resolution";

  if (anomaly_type === "coordinated") {
    const side = cluster_direction?.toUpperCase() ?? "?";
    const vol = `$${Math.round(total_volume).toLocaleString()}`;
    const duration = cluster_start && cluster_end
      ? Math.round((new Date(cluster_end).getTime() - new Date(cluster_start).getTime()) / 60000)
      : null;
    const window = duration != null ? `${duration}-minute` : "short";
    const priceLabel = pre_trade_prob != null
      ? ` (${side} contracts priced at ${pre_trade_prob}¢)`
      : "";
    return {
      headline: `${trade_count} trades all buying ${side}${priceLabel} within a ${window} window, ${hrs}`,
      detail: `A z-score of ${z_score ?? "n/a"} means this ${window} burst of ${vol} was statistically extreme vs. every other time window in this market. This pattern is consistent with a single actor splitting a large order algorithmically, or multiple coordinated traders firing at the same moment. The trades were on the ${resolution?.toUpperCase() ?? "?"}-resolving side — the market ${resolution === cluster_direction ? "confirmed" : "confounded"} their bet.`,
    };
  }

  if (anomaly_type === "golden_window") {
    const side = resolution?.toUpperCase() ?? "?";
    const prob = pre_trade_prob ?? "?";
    const implied = pre_trade_prob != null ? 100 - pre_trade_prob : null;
    const oddsStr = implied != null ? ` — a ${implied}% longshot` : "";
    return {
      headline: `${trade_count} trades buying ${side} at ${prob}¢${oddsStr}, ${hrs}`,
      detail: `These trades bet on the winning outcome when the market implied only a ${prob}% chance of ${side}. Correctly calling a low-probability outcome at this volume, this close to resolution, is the defining signature of the "golden window" pattern — either extraordinary luck or advance knowledge of how the market would resolve.`,
    };
  }

  if (anomaly_type === "volume_spike") {
    const vol = `$${Math.round(total_volume).toLocaleString()}`;
    return {
      headline: `Trading volume spiked ${z_score ?? "?"}σ above the market's baseline, ${hrs}`,
      detail: `In the flagged hour, ${vol} in volume was recorded — ${z_score ?? "?"} standard deviations above this market's normal hourly average. Unexplained volume surges preceding resolution can indicate informed trading, pre-positioned hedging, or coordinated accumulation that doesn't show up as a directional cluster.`,
    };
  }

  return {
    headline: "Anomaly flagged by the detection engine",
    detail: "Review the trade chart and timeline below for context.",
  };
}

// ─── Context-aware metrics ────────────────────────────────────────────────────

function buildMetrics(anomaly: AnomalyRecord, market: MarketRecord | null): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];
  const { anomaly_type, trade_count, total_volume, cluster_direction, cluster_start,
    cluster_end, pre_trade_prob, hours_before_resolution, resolution, z_score } = anomaly;

  if (anomaly_type === "coordinated") {
    const side = cluster_direction?.toUpperCase() ?? "?";
    metrics.push({ label: "Cluster trades", value: String(trade_count) });
    metrics.push({ label: "Cluster volume", value: `$${Math.round(total_volume).toLocaleString()}` });
    metrics.push({ label: "Direction", value: side });
    if (pre_trade_prob != null) {
      metrics.push({ label: `${side} price at cluster`, value: `${pre_trade_prob}¢` });
    }
    if (cluster_start && cluster_end) {
      const mins = Math.round(
        (new Date(cluster_end).getTime() - new Date(cluster_start).getTime()) / 60000,
      );
      metrics.push({ label: "Cluster duration", value: `${mins} min` });
    }
  } else if (anomaly_type === "golden_window") {
    const side = resolution?.toUpperCase() ?? "?";
    metrics.push({ label: "Flagged trades", value: String(trade_count) });
    metrics.push({ label: "Notional at risk", value: `$${Math.round(total_volume).toLocaleString()}` });
    if (pre_trade_prob != null) {
      metrics.push({ label: `${side} price at trade`, value: `${pre_trade_prob}¢` });
      metrics.push({ label: "Implied YES odds", value: `${pre_trade_prob}%` });
    }
  } else {
    // volume_spike
    metrics.push({ label: "Trades in spike hour", value: String(trade_count) });
    metrics.push({ label: "Spike volume", value: `$${Math.round(total_volume).toLocaleString()}` });
    if (pre_trade_prob != null) {
      metrics.push({ label: "YES price at spike", value: `${pre_trade_prob}¢` });
    }
  }

  if (hours_before_resolution != null) {
    metrics.push({ label: "Time before resolution", value: `${hours_before_resolution}h` });
  }
  if (z_score != null) {
    metrics.push({ label: "Z-score", value: String(z_score) });
  }
  metrics.push({ label: "Resolution", value: resolution?.toUpperCase() ?? "n/a" });
  metrics.push({ label: "Market status", value: market?.status ?? "unknown" });

  return metrics;
}

// ─── PDF export ───────────────────────────────────────────────────────────────

function tableRow(label: string, value: string) {
  return `<tr><td>${label}</td><td><strong>${value}</strong></td></tr>`;
}

function exportCaseFile(anomaly: AnomalyRecord, market: MarketRecord | null) {
  const now = new Date().toLocaleString();
  const sev = anomaly.severity;
  const sevColor: Record<string, string> = {
    CRITICAL: "#ff3b5c", HIGH: "#ff8a4c", MEDIUM: "#fbbf24", LOW: "#94a3b8",
  };
  const color = sevColor[sev] ?? "#94a3b8";
  const { headline, detail } = patternSummary(anomaly);
  const metrics = buildMetrics(anomaly, market);

  const tradeRows = anomaly.flagged_trades?.map(
    (t) => `<tr><td style="font-family:monospace;font-size:11px">${t.trade_id ?? "n/a"}</td><td>${t.price_cents}¢</td><td>${t.count}</td><td>${t.hours_before}h</td></tr>`
  ).join("") ?? "";

  const explanationItems = anomaly.explanations?.map(
    (ex) => `<li>${ex}</li>`
  ).join("") ?? "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Case File — ${anomaly.ticker}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; color: #1e293b; padding: 48px; max-width: 860px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.3; margin-bottom: 4px; }
  h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #475569; margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .badge { display: inline-block; border-radius: 99px; padding: 3px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${color}; border: 1px solid ${color}40; background: ${color}12; margin-right: 6px; }
  .chip { display: inline-block; border-radius: 99px; padding: 2px 8px; font-size: 11px; color: #64748b; border: 1px solid #e2e8f0; background: #f8fafc; margin-right: 4px; font-family: monospace; }
  .pattern { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 16px 0 0; }
  .pattern-headline { font-weight: 600; color: #0f172a; margin-bottom: 6px; line-height: 1.5; }
  .pattern-detail { color: #475569; font-size: 12px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  td, th { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; text-align: left; color: #475569; }
  td:first-child { color: #64748b; width: 38%; }
  p { line-height: 1.7; color: #334155; margin-bottom: 10px; }
  ul { padding-left: 18px; margin-bottom: 10px; }
  li { margin-bottom: 4px; line-height: 1.6; color: #334155; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px; }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>
<div class="meta">Generated ${now} · Kalshi Watchdog</div>
<h1>${anomaly.market_title}</h1>
<div style="margin: 12px 0 0">
  <span class="badge">${sev}</span>
  <span class="chip">${anomaly.anomaly_type.replace(/_/g, " ")}</span>
  <span class="chip">${anomaly.ticker}</span>
</div>
<div class="pattern">
  <div class="pattern-headline">${headline}</div>
  <div class="pattern-detail">${detail}</div>
</div>

<h2>AI Narrative</h2>
<p>${anomaly.llm_summary || "No LLM summary attached to this record."}</p>
<p style="color:#64748b;font-size:12px">${anomaly.llm_reasoning || "No detailed reasoning attached."}</p>
${explanationItems ? `<h2>Key Signals</h2><ul>${explanationItems}</ul>` : ""}

<h2>Case Metrics</h2>
<table>
  <tbody>
    ${metrics.map((m) => tableRow(m.label, m.value)).join("\n    ")}
    ${tableRow("Detected at", new Date(anomaly.detected_at).toLocaleString())}
  </tbody>
</table>

<h2>Market</h2>
<table>
  <tbody>
    ${tableRow("Title", market?.title ?? anomaly.market_title)}
    ${tableRow("Status", market?.status ?? "unknown")}
    ${tableRow("Close time", market?.close_time ? new Date(market.close_time).toLocaleString() : "n/a")}
  </tbody>
</table>

${anomaly.flagged_trades?.length ? `
<h2>Flagged Trade Log</h2>
<table>
  <thead><tr><th>Trade ID</th><th>Price</th><th>Count</th><th>Hours Before</th></tr></thead>
  <tbody>${tradeRows}</tbody>
</table>` : ""}

${anomaly.anomaly_type === "coordinated" && anomaly.cluster_start ? `
<h2>Cluster Window</h2>
<table><tbody>
  ${tableRow("Start", new Date(anomaly.cluster_start).toLocaleString())}
  ${anomaly.cluster_end ? tableRow("End", new Date(anomaly.cluster_end).toLocaleString()) : ""}
  ${anomaly.cluster_direction ? tableRow("Direction", anomaly.cluster_direction.toUpperCase()) : ""}
</tbody></table>` : ""}

<div class="footer">Exported from Kalshi Watchdog — for investigative use only.</div>
<script>window.onload = () => window.print();</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnomalyDetail() {
  const { anomalyId = "" } = useParams();
  const [detail, setDetail] = useState<AnomalyDetailResponse | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);

    getAnomaly(anomalyId)
      .then((response) => {
        if (!active) return;
        setDetail(response);
        return getMarketTrades(response.anomaly.ticker);
      })
      .then((tradeData) => {
        if (active && tradeData) setTrades(tradeData);
      })
      .catch(() => {
        if (active) setError("Unable to load anomaly detail");
      });

    return () => { active = false; };
  }, [anomalyId]);

  if (error) {
    return <div className="panel"><p className="text-sm text-text-secondary">{error}</p></div>;
  }

  if (!detail) {
    return <div className="panel"><p className="text-sm text-text-secondary">Loading anomaly detail…</p></div>;
  }

  const { anomaly, market } = detail;
  const { headline, detail: patternDetail } = patternSummary(anomaly);
  const metrics = buildMetrics(anomaly, market);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="button-secondary">Back to dashboard</Link>
        <button type="button" className="button-secondary" onClick={() => exportCaseFile(anomaly, market)}>
          Export case file
        </button>
      </div>

      <section className="panel">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">

          {/* ── Left: narrative ── */}
          <div>
            <p className="eyebrow">Anomaly detail</p>
            <h1 className="max-w-[18ch] text-4xl font-semibold leading-tight text-text-primary">
              {anomaly.market_title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <SeverityBadge severity={anomaly.severity} />
              <span className="data-chip">{anomaly.anomaly_type.replace(/_/g, " ")}</span>
              <span className="data-chip">{anomaly.ticker}</span>
              {anomaly.z_score != null && (
                <span className="data-chip">z = {anomaly.z_score}</span>
              )}
            </div>

            {/* Plain-English pattern explainer */}
            <div className="mt-6 rounded-[18px] border border-border-default bg-bg-secondary px-5 py-4">
              <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary mb-2">What this pattern means</p>
              <p className="text-sm font-medium leading-6 text-text-primary">{headline}</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{patternDetail}</p>
            </div>

            {/* LLM narrative */}
            {(anomaly.llm_summary || anomaly.llm_reasoning) && (
              <div className="mt-5">
                <p className="text-xs uppercase tracking-[0.14em] text-text-tertiary mb-2">AI analysis</p>
                <p className="text-sm leading-7 text-text-secondary">
                  {anomaly.llm_summary || "Narrative analysis not yet attached."}
                </p>
                {anomaly.llm_reasoning && (
                  <p className="mt-3 text-sm leading-7 text-text-secondary">{anomaly.llm_reasoning}</p>
                )}
              </div>
            )}

            {anomaly.explanations && anomaly.explanations.length > 0 && (
              <ul className="mt-4 space-y-1">
                {anomaly.explanations.map((ex, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    {ex}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Right: context-aware metrics ── */}
          <div className="rounded-[24px] border border-border-default bg-bg-secondary p-5">
            <p className="eyebrow">Case metrics</p>
            <dl className="mt-4 space-y-3 text-sm">
              {metrics.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="font-mono text-text-primary text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <PriceVolumeOverlay trades={trades} anomaly={anomaly} />
        <Timeline anomaly={anomaly} market={market} trades={trades} />
      </div>
    </div>
  );
}
