import { useEffect, useState } from "react";

import { getAnomalies, getKnownCases } from "../api/client";
import { AnomalyTimeline } from "../components/AnomalyTimeline";
import { CategoryBreakdown } from "../components/CategoryBreakdown";
import { ForceGraph } from "../components/ForceGraph";
import { SeverityBreakdown } from "../components/SeverityBreakdown";
import type { AnomalyRecord, KnownCase } from "../types";

export function Analytics() {
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [knownCases, setKnownCases] = useState<KnownCase[]>([]);

  useEffect(() => {
    getAnomalies().then(setAnomalies).catch(() => undefined);
    getKnownCases().then(setKnownCases).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">

      {/* ── Network graph ── */}
      <ForceGraph anomalies={anomalies} knownCases={knownCases} />

      {/* ── Charts + timeline ── */}
      <section className="grid items-start gap-6 xl:grid-cols-3">
        <CategoryBreakdown anomalies={anomalies} />
        <SeverityBreakdown anomalies={anomalies} />
        <AnomalyTimeline anomalies={anomalies} />
      </section>

    </div>
  );
}
