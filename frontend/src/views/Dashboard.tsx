import { useState } from "react";

import { AnomalyFeed } from "../components/AnomalyFeed";
import { LiveDetectionStream } from "../components/LiveDetectionStream";
import { LocalControlPanel } from "../components/LocalControlPanel";
import { StatsBar } from "../components/StatsBar";

export function Dashboard() {
  const [refreshToken, setRefreshToken] = useState(0);

  function handlePipelineChange() {
    setRefreshToken((t) => t + 1);
  }

  return (
    <div className="space-y-6">

      {/* ── Stats bar ── */}
      <StatsBar refreshToken={refreshToken} />

      {/* ── Controls + Anomaly feed ── */}
      <section className="grid items-start gap-6 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
        <LocalControlPanel onPipelineChange={handlePipelineChange} />
        <AnomalyFeed refreshToken={refreshToken} />
      </section>

      {/* ── Live detection stream ── */}
      <LiveDetectionStream onComplete={handlePipelineChange} />

    </div>
  );
}
