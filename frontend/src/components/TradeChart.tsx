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

import type { AnomalyRecord, TradeRecord } from "../types";

function bucketTrades(trades: TradeRecord[]) {
  const buckets = new Map<string, { hour: string; volume: number; flagged: boolean }>();
  trades.forEach((trade) => {
    const hour = trade.created_time.slice(0, 13);
    const existing = buckets.get(hour) ?? { hour, volume: 0, flagged: false };
    existing.volume += Number(trade.volume_dollars ?? (trade.count * trade.yes_price) / 100);
    buckets.set(hour, existing);
  });
  return [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

export function TradeChart({
  trades,
  anomaly,
}: {
  trades: TradeRecord[];
  anomaly: AnomalyRecord;
}) {
  const data = bucketTrades(trades).map((item) => ({
    ...item,
    flagged: anomaly.anomaly_type === "volume_spike" && item.hour === anomaly.anomaly_hour?.slice(0, 13),
  }));

  return (
    <div className="panel h-[360px]">
      <div className="mb-4">
        <p className="eyebrow">Trade intensity</p>
        <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
          Hourly notional volume
        </h2>
      </div>

      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.08)" vertical={false} />
          <XAxis dataKey="hour" tick={{ fill: "#f1f5f9", fontSize: 11 }} />
          <YAxis tick={{ fill: "#f1f5f9", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "rgba(99, 220, 190, 0.06)" }}
            contentStyle={{
              background: "#0f1726",
              border: "1px solid rgba(148, 163, 184, 0.12)",
              borderRadius: 16,
              color: "#f1f5f9",
            }}
          />
          <Bar dataKey="volume" radius={[10, 10, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.hour}
                fill={entry.flagged ? "var(--severity-critical)" : "var(--accent)"}
                fillOpacity={entry.flagged ? 1 : 0.78}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
