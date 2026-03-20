import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getCandlesticks } from "../api/client";
import type { CandlestickData } from "../api/client";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

interface ChartPoint {
  date: string;
  price: number;
}

function formatCandlesticks(candles: CandlestickData[]): ChartPoint[] {
  return candles.map((c) => ({
    date: new Date(c.end_period_ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    price: Math.round(parseFloat(c.price.close_dollars) * 100),
  }));
}

async function fetchTradeChart(ticker: string): Promise<ChartPoint[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/kalshi/trades?ticker=${encodeURIComponent(ticker)}&limit=200`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error("trades failed");
  const trades: { created_time?: string; yes_price?: number; no_price?: number; taker_side?: string }[] = await res.json();
  if (!trades.length) return [];

  // Bucket into ~20 evenly-spaced points
  const sorted = [...trades].sort((a, b) =>
    (a.created_time ?? "") < (b.created_time ?? "") ? -1 : 1,
  );
  const step = Math.max(1, Math.floor(sorted.length / 20));
  return sorted
    .filter((_, i) => i % step === 0 || i === sorted.length - 1)
    .map((t) => {
      const price = t.taker_side === "no"
        ? 100 - (t.no_price ?? 0)
        : (t.yes_price ?? 0);
      const label = t.created_time
        ? new Date(t.created_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "";
      return { date: label, price };
    })
    .filter((p) => p.price > 0);
}

export function MarketPriceChart({ ticker, onEmpty }: { ticker: string; onEmpty?: () => void }) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"candles" | "trades" | null>(null);

  useEffect(() => {
    let active = true;
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - 30 * 24 * 60 * 60;

    getCandlesticks(ticker, startTs, endTs, 1440)
      .then((res) => {
        if (!active) return;
        if (res.candlesticks?.length) {
          setData(formatCandlesticks(res.candlesticks));
          setSource("candles");
          return;
        }
        return fetchTradeChart(ticker).then((pts) => {
          if (!active) return;
          setData(pts);
          setSource("trades");
        });
      })
      .catch(() => {
        if (!active) return;
        fetchTradeChart(ticker)
          .then((pts) => { if (active) { setData(pts); setSource("trades"); } })
          .catch(() => { if (active) setSource(null); });
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => { active = false; };
  }, [ticker]);

  useEffect(() => {
    if (!loading && !data.length) onEmpty?.();
  }, [loading, data.length, onEmpty]);

  if (loading) return <p className="mt-3 text-xs text-text-tertiary">Loading price chart…</p>;
  if (!data.length) return null;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.12em] text-text-tertiary">YES price %</p>
        {source === "trades" && (
          <p className="text-[10px] text-text-tertiary">via recent trades</p>
        )}
      </div>
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.07)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#f1f5f9", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "#f1f5f9", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={{ stroke: "#00f0ff", strokeWidth: 1, strokeDasharray: "4 2" }}
              contentStyle={{
                background: "#0f1726",
                border: "1px solid rgba(148,163,184,0.12)",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelStyle={{ color: "#94a3b8" }}
              itemStyle={{ color: "#94a3b8" }}
              formatter={(value: number) => [`${value}%`, "YES price"]}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="#00f0ff"
              strokeWidth={1.5}
              fill={`url(#grad-${ticker})`}
              dot={false}
              activeDot={{ r: 4, fill: "#00f0ff" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
