import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnomalyRecord, Severity } from "../types";

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: "#ff2a6d",
  HIGH: "#ff9e64",
  MEDIUM: "#f59e0b",
  LOW: "#64748b",
};

export function SeverityBreakdown({ anomalies }: { anomalies: AnomalyRecord[] }) {
  const counts = new Map<Severity, number>(SEVERITY_ORDER.map((s) => [s, 0]));
  for (const a of anomalies) {
    const severity = a.severity as Severity | undefined;
    if (severity && counts.has(severity)) {
      counts.set(severity, (counts.get(severity) ?? 0) + 1);
    }
  }

  const data = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: counts.get(severity) ?? 0,
    color: SEVERITY_COLORS[severity],
  }));

  const total = anomalies.length;

  return (
    <div className="panel">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Signal quality</p>
          <h2 className="font-mono text-base font-semibold uppercase tracking-[0.12em] text-text-primary">
            Severity breakdown
          </h2>
        </div>
        <span className="text-xs uppercase tracking-[0.16em] text-text-tertiary">
          {total} total
        </span>
      </div>

      {total === 0 ? (
        <p className="text-sm text-text-secondary">
          Run detection to populate severity breakdown.
        </p>
      ) : (
        <>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <XAxis
                  dataKey="severity"
                  tick={{ fill: "#f1f5f9", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "#f1f5f9", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(99,220,190,0.05)" }}
                  contentStyle={{
                    background: "#0f1726",
                    border: "1px solid rgba(148,163,184,0.12)",
                    borderRadius: 12,
                    color: "#f1f5f9",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#94a3b8" }}
                  formatter={(value: number) => [value, "anomalies"]}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {data.map((entry) => (
                    <Cell key={entry.severity} fill={entry.color} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Inline legend with counts */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {data.map((entry) => (
              <div key={entry.severity} className="text-center">
                <p
                  className="font-mono text-lg font-semibold"
                  style={{ color: entry.color }}
                >
                  {entry.count}
                </p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  {entry.severity.slice(0, 4)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
