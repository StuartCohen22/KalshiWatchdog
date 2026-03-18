import { useEffect, useState } from "react";
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

import { getOrderbook } from "../api/client";

interface BookLevel {
  price: number;
  yes: number;
  no: number;
  side: "yes" | "no";
}

function parseOrderbook(raw: {
  yes_dollars?: [string, string][];
  no_dollars?: [string, string][];
}): BookLevel[] {
  const levels = new Map<number, BookLevel>();

  for (const [priceStr, sizeStr] of raw.yes_dollars ?? []) {
    const price = Math.round(parseFloat(priceStr) * 100);
    const size = parseFloat(sizeStr);
    levels.set(price, { price, yes: size, no: 0, side: "yes" });
  }

  for (const [priceStr, sizeStr] of raw.no_dollars ?? []) {
    // no_dollars price = 1 - yes_price, so yes-equivalent = 100 - no_price_cents
    const noPrice = Math.round(parseFloat(priceStr) * 100);
    const yesEquiv = 100 - noPrice;
    const size = parseFloat(sizeStr);
    const existing = levels.get(yesEquiv);
    if (existing) {
      existing.no = size;
    } else {
      levels.set(yesEquiv, { price: yesEquiv, yes: 0, no: size, side: "no" });
    }
  }

  return [...levels.values()]
    .filter((l) => l.price >= 1 && l.price <= 99)
    .sort((a, b) => a.price - b.price)
    .slice(0, 20);
}

export function OrderbookChart({ ticker, onEmpty }: { ticker: string; onEmpty?: () => void }) {
  const [data, setData] = useState<BookLevel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getOrderbook(ticker)
      .then((res) => {
        if (!active) return;
        const ob = res.orderbook_fp;
        if (ob) setData(parseOrderbook(ob));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [ticker]);

  useEffect(() => {
    if (!loading && !data.length) onEmpty?.();
  }, [loading, data.length, onEmpty]);

  if (loading) return <p className="mt-3 text-xs text-text-tertiary">Loading orderbook…</p>;
  if (!data.length) return null;

  return (
    <div className="mt-4 h-[140px]">
      <p className="mb-2 text-xs uppercase tracking-[0.12em] text-text-tertiary">
        Bid/ask depth — YES price %
      </p>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data} margin={{ top: 0, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.07)" vertical={false} />
          <XAxis
            dataKey="price"
            tick={{ fill: "#475569", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: "#0f1726",
              border: "1px solid rgba(148,163,184,0.12)",
              borderRadius: 12,
              color: "#f1f5f9",
              fontSize: 12,
            }}
            labelStyle={{ color: "#94a3b8" }}
            itemStyle={{ color: "#94a3b8" }}
            formatter={(value: number, name: string) => [
              value.toLocaleString(),
              name === "yes" ? "YES bids" : "NO bids (YES equiv)",
            ]}
            labelFormatter={(label: number) => `Price: ${label}%`}
          />
          <Bar dataKey="yes" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={`yes-${entry.price}`} fill="#63dcbe" fillOpacity={0.8} />
            ))}
          </Bar>
          <Bar dataKey="no" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={`no-${entry.price}`} fill="#fbbf24" fillOpacity={0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
