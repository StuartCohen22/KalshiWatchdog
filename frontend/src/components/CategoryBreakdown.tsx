import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnomalyRecord } from "../types";

const PALETTE = [
  "#00f0ff",
  "#f59e0b",
  "#ff2a6d",
  "#00f0ff",
  "#fb923c",
  "#34d399",
  "#f472b6",
  "#60a5fa",
];

function deriveCategory(ticker: string): string {
  const prefix = ticker.split("-")[0].replace(/^KX/, "");
  // Abbreviate long prefixes
  if (prefix.length > 10) return prefix.slice(0, 10);
  return prefix || "OTHER";
}

export function CategoryBreakdown({ anomalies }: { anomalies: AnomalyRecord[] }) {
  const counts = new Map<string, number>();
  for (const a of anomalies) {
    const cat = deriveCategory(a.ticker);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  const data = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));

  return (
    <div className="panel">
      <div className="mb-4">
        <p className="eyebrow">Signal distribution</p>
        <h2 className="font-mono text-base font-semibold uppercase tracking-[0.12em] text-text-primary">
          Anomalies by category
        </h2>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Run detection to populate category breakdown.
        </p>
      ) : (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.07)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={72}
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
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
