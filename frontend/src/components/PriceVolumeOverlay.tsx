import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnomalyRecord, TradeRecord } from "../types";

// Colors per flagged type — hex only (SVG attributes don't resolve CSS vars)
const FLAG_COLOR: Record<string, string> = {
  volume_spike: "#ff2a6d",
  coordinated: "#ff9e64",
  golden_window: "#f59e0b",
};

interface DataPoint {
  hour: string;
  volume: number;
  price: number | null;
  flagType: string | null; // null = unflagged
}

function buildOverlay(trades: TradeRecord[], anomaly: AnomalyRecord): DataPoint[] {
  const buckets = new Map<string, { volume: number; prices: number[] }>();

  for (const trade of trades) {
    const hour = trade.created_time.slice(0, 13);
    const existing = buckets.get(hour) ?? { volume: 0, prices: [] };
    existing.volume += Number(trade.volume_dollars ?? 0);
    const price = trade.taker_side === "yes" ? trade.yes_price : trade.no_price;
    if (price > 0) existing.prices.push(price);
    buckets.set(hour, existing);
  }

  const anomalyHour = anomaly.anomaly_hour?.slice(0, 13) ?? "";
  const clusterStart = anomaly.cluster_start?.slice(0, 13) ?? "";
  const clusterEnd = anomaly.cluster_end?.slice(0, 13) ?? "";

  // Build set of flagged hours for golden_window from flagged_trades
  const goldenHours = new Set<string>();
  if (anomaly.anomaly_type === "golden_window" && anomaly.flagged_trades) {
    for (const ft of anomaly.flagged_trades) {
      goldenHours.add(ft.created_time.slice(0, 13));
    }
  }

  const anomalyType = anomaly.anomaly_type ?? "unknown";

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, { volume, prices }]) => {
      let flagType: string | null = null;
      if (anomalyType === "volume_spike" && hour === anomalyHour) {
        flagType = "volume_spike";
      } else if (anomalyType === "coordinated" && clusterStart && clusterEnd && hour >= clusterStart && hour <= clusterEnd) {
        flagType = "coordinated";
      } else if (anomalyType === "golden_window" && goldenHours.has(hour)) {
        flagType = "golden_window";
      }
      return {
        hour: hour.slice(5), // "MM-DD HH"
        volume: Math.round(volume),
        price: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
        flagType,
      };
    });
}

function clusterLabel(anomaly: AnomalyRecord): string | null {
  if (anomaly.anomaly_type === "coordinated" && anomaly.cluster_start && anomaly.cluster_end) {
    const start = new Date(anomaly.cluster_start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
    const end = new Date(anomaly.cluster_end).toLocaleString(undefined, { hour: "numeric" });
    return `Cluster: ${start} – ${end}`;
  }
  return null;
}

export function PriceVolumeOverlay({
  trades,
  anomaly,
}: {
  trades: TradeRecord[];
  anomaly: AnomalyRecord;
}) {
  const anomalyType = anomaly.anomaly_type ?? "unknown";
  const data = buildOverlay(trades, anomaly);
  const label = clusterLabel(anomaly);

  if (data.length === 0) {
    return (
      <div className="panel h-[360px] flex items-center justify-center">
        <p className="text-sm text-text-secondary">No trade data to chart.</p>
      </div>
    );
  }

  const flagColor = FLAG_COLOR[anomalyType] ?? "#00f0ff";

  return (
    <div className="panel h-[360px]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Trade intensity</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
            Volume + implied probability
          </h2>
        </div>
        {label && (
          <span
            className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em]"
            style={{ color: flagColor, borderColor: `${flagColor}40` }}
          >
            {label}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height="80%">
        <ComposedChart data={data} margin={{ top: 4, right: 24, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.07)" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fill: "#f1f5f9", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="vol"
            orientation="left"
            tick={{ fill: "#f1f5f9", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={[0, 100]}
            tick={{ fill: "#f1f5f9", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            cursor={{ fill: "rgba(99,220,190,0.05)" }}
            contentStyle={{
              background: "#0f1726",
              border: "1px solid rgba(148,163,184,0.12)",
              borderRadius: 14,
              color: "#f1f5f9",
              fontSize: 12,
            }}
            labelStyle={{ color: "#94a3b8" }}
            itemStyle={{ color: "#94a3b8" }}
            formatter={(value: number, name: string) =>
              name === "price" ? [`${value}%`, "YES price"] : [`$${value.toLocaleString()}`, "Volume"]
            }
          />

          {/* Reference lines for coordinated cluster window */}
          {anomaly.anomaly_type === "coordinated" && anomaly.cluster_start && (
            <ReferenceLine
              yAxisId="vol"
              x={anomaly.cluster_start.slice(5, 13)}
              stroke="#ff9e64"
              strokeDasharray="4 3"
              strokeOpacity={0.6}
            />
          )}
          {anomaly.anomaly_type === "coordinated" && anomaly.cluster_end && (
            <ReferenceLine
              yAxisId="vol"
              x={anomaly.cluster_end.slice(5, 13)}
              stroke="#ff9e64"
              strokeDasharray="4 3"
              strokeOpacity={0.6}
            />
          )}

          <Bar yAxisId="vol" dataKey="volume" radius={[6, 6, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.flagType ? FLAG_COLOR[entry.flagType] : "#00f0ff"}
                fillOpacity={entry.flagType ? 0.9 : 0.45}
              />
            ))}
          </Bar>
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#f59e0b" }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
