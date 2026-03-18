import { useEffect, useState } from "react";

import { getAnomalies, getKnownCases } from "../api/client";
import { AnomalyFeed } from "../components/AnomalyFeed";
import { AnomalyTimeline } from "../components/AnomalyTimeline";
import { CategoryBreakdown } from "../components/CategoryBreakdown";
import { SeverityBreakdown } from "../components/SeverityBreakdown";
import { ForceGraph } from "../components/ForceGraph";
import { LiveDetectionStream } from "../components/LiveDetectionStream";
import { LocalControlPanel } from "../components/LocalControlPanel";
import { MarketReconPanel } from "../components/MarketReconPanel";
import { StatsBar } from "../components/StatsBar";
import type { AnomalyRecord, KnownCase } from "../types";

const GUIDE_STEPS = [
  {
    label: "1. Kalshi watchlist",
    desc: "Live prediction markets from Kalshi sorted by risk signal. Click Price chart, Depth, or Explain on any card.",
  },
  {
    label: "2. Run the pipeline",
    desc: "Use Local Controls: Reset → Ingest settled markets → Ingest trades → Run detection. This backfills and scores a historical cohort.",
  },
  {
    label: "3. Anomaly feed",
    desc: "After detection, flagged markets appear in the feed. Severity is based on z-score, volume, and timing relative to resolution.",
  },
  {
    label: "4. Deep-dive a case",
    desc: "Click any anomaly for a detail page with a price + volume overlay chart, event timeline, and AI-generated narrative.",
  },
];

function HowToUse() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4"
      >
        <div className="text-left">
          <p className="eyebrow">Getting started</p>
          <h2 className="font-mono text-base font-semibold uppercase tracking-[0.12em] text-text-primary">
            How to use this app
          </h2>
        </div>
        <span className="text-xs uppercase tracking-[0.16em] text-text-tertiary">
          {open ? "collapse" : "expand"}
        </span>
      </button>

      {open ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {GUIDE_STEPS.map((step) => (
            <div key={step.label} className="rounded-[16px] border border-border-default bg-bg-secondary p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{step.label}</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{step.desc}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Dashboard() {
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [knownCases, setKnownCases] = useState<KnownCase[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    getAnomalies().then(setAnomalies).catch(() => undefined);
    getKnownCases().then(setKnownCases).catch(() => undefined);
  }, [refreshToken]);

  function handlePipelineChange() {
    setRefreshToken((t) => t + 1);
  }

  return (
    <div className="space-y-6">

      {/* ── Getting started guide ── */}
      <HowToUse />

      {/* ── Stats bar ── */}
      <StatsBar refreshToken={refreshToken} />

      {/* ── Main 3-column grid ── */}
      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(280px,1fr)]">

        {/* Left: live watchlist */}
        <MarketReconPanel />

        {/* Center: anomaly feed */}
        <AnomalyFeed refreshToken={refreshToken} />

        {/* Right: pipeline controls */}
        <LocalControlPanel onPipelineChange={handlePipelineChange} />

      </section>

      {/* ── Bottom row: network graph + charts + live stream ── */}
      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
        <ForceGraph anomalies={anomalies} knownCases={knownCases} />
        <CategoryBreakdown anomalies={anomalies} />
        <SeverityBreakdown anomalies={anomalies} />
      </section>

      {/* ── Live stream + Temporal scatter ── */}
      <section className="grid items-start gap-6 xl:grid-cols-[minmax(360px,0.5fr)_minmax(0,1fr)]">
        <LiveDetectionStream onComplete={handlePipelineChange} />
        <AnomalyTimeline anomalies={anomalies} />
      </section>

    </div>
  );
}
