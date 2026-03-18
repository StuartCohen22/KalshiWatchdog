import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { AnomalyRecord } from "../types";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_NUM: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// Canvas-safe colors for the custom dot (CSS vars don't work inside SVG fill)
const TYPE_COLOR_HEX: Record<string, string> = {
  golden_window: "#ff3b5c",
  coordinated: "#ff8a4c",
  volume_spike: "#fbbf24",
};

const TYPE_LABEL: Record<string, string> = {
  golden_window: "golden window",
  coordinated: "coordinated",
  volume_spike: "volume spike",
};

// ─── Data preparation ─────────────────────────────────────────────────────────

interface PlotPoint {
  x: number;          // hours before resolution, negated so left = earlier
  y: number;          // severity 1–4
  z: number;          // bubble size proxy
  anomaly_id: string;
  label: string;
  type: string;
  severity: string;
  volume: number;
}

function buildPoints(anomalies: AnomalyRecord[]): PlotPoint[] {
  return anomalies
    .filter((a) => a.hours_before_resolution != null)
    .map((a) => ({
      x: -(a.hours_before_resolution as number),
      y: SEVERITY_NUM[a.severity] ?? 1,
      z: Math.max(Math.sqrt(Math.max(a.total_volume ?? 0, 1)) * 6, 40),
      anomaly_id: a.anomaly_id,
      label: a.market_title,
      type: a.anomaly_type,
      severity: a.severity,
      volume: a.total_volume ?? 0,
    }));
}

// ─── Custom dot — clickable, colored by type ──────────────────────────────────

function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: PlotPoint;
  onDotClick: (id: string) => void;
}) {
  const { cx = 0, cy = 0, payload, onDotClick } = props;
  if (!payload) return null;
  const fill = TYPE_COLOR_HEX[payload.type] ?? "#63dcbe";
  const r = Math.max(Math.sqrt(payload.z / Math.PI), 4);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      fillOpacity={0.75}
      stroke={fill}
      strokeWidth={1}
      style={{ cursor: "pointer" }}
      onClick={() => onDotClick(payload.anomaly_id)}
    />
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: PlotPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "#0f1726",
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 14,
        padding: "10px 14px",
        fontSize: 12,
        maxWidth: 240,
      }}
    >
      <p style={{ color: "#f1f5f9", marginBottom: 4, fontWeight: 600, lineHeight: 1.4 }}>{d.label}</p>
      <p style={{ color: "#94a3b8" }}>{TYPE_LABEL[d.type] ?? d.type} · {d.severity}</p>
      <p style={{ color: "#64748b", marginTop: 2 }}>
        {Math.abs(d.x).toFixed(1)}h before resolution
      </p>
      <p style={{ color: "#64748b" }}>
        vol ${Math.round(d.volume).toLocaleString()}
      </p>
      <p style={{ color: "#63dcbe", marginTop: 6, fontSize: 11 }}>Click to inspect →</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnomalyTimeline({ anomalies }: { anomalies: AnomalyRecord[] }) {
  const navigate = useNavigate();
  const points = buildPoints(anomalies);
  const hasData = points.length > 0;

  function handleDotClick(id: string) {
    navigate(`/anomalies/${id}`);
  }

  const yTickFormatter = (v: number) => (["", "LOW", "MED", "HIGH", "CRIT"] as const)[v] ?? "";

  return (
    <div className="panel">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Temporal pattern</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
            Anomaly timing vs. resolution
          </h2>
          <p className="mt-1 text-xs text-text-tertiary">
            Each dot = one flagged market. Dot size ∝ trade volume. Click to inspect.
          </p>
        </div>
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.14em] text-text-tertiary">
          {Object.entries(TYPE_LABEL).map(([type, label]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: TYPE_COLOR_HEX[type] }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Chart or empty state */}
      {!hasData ? (
        <div className="flex h-[280px] items-center justify-center rounded-[20px] border border-dashed border-border-default">
          <p className="text-sm text-text-secondary">Run detection to populate the timeline.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 8, right: 24, bottom: 32, left: 0 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.07)" />

            {/* Danger zone: final 48h before resolution */}
            <ReferenceArea
              x1={-48}
              x2={0}
              fill="rgba(255,59,92,0.06)"
              label={{
                value: "danger zone",
                position: "insideTopLeft",
                fill: "#ff3b5c",
                fontSize: 10,
                fontFamily: "JetBrains Mono",
              }}
            />

            {/* Resolution line */}
            <ReferenceLine
              x={0}
              stroke="#ff3b5c"
              strokeDasharray="4 3"
              label={{
                value: "resolution",
                position: "insideTopRight",
                fill: "#ff3b5c",
                fontSize: 10,
                fontFamily: "JetBrains Mono",
              }}
            />

            <XAxis
              type="number"
              dataKey="x"
              name="hours"
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}h`}
              label={{
                value: "hours relative to resolution →",
                position: "insideBottom",
                offset: -20,
                fill: "#475569",
                fontSize: 10,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="severity"
              domain={[0.5, 4.5]}
              ticks={[1, 2, 3, 4]}
              tickFormatter={yTickFormatter}
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <ZAxis type="number" dataKey="z" range={[40, 600]} />

            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "rgba(148,163,184,0.2)" }}
              content={<CustomTooltip />}
            />

            <Scatter
              data={points}
              shape={(props: Record<string, unknown>) => (
                <CustomDot
                  {...(props as { cx?: number; cy?: number; payload?: PlotPoint })}
                  onDotClick={handleDotClick}
                />
              )}
            />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
