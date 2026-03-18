import { useEffect, useRef, useState } from "react";
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

import { getMarketTrades, searchMarkets } from "../api/client";
import type { FlaggedTradeRow, MarketRecord, TradeFlag, TradeRecord } from "../types";

// ─── Suspicious trade scoring ─────────────────────────────────────────────────

function hoursBeforeClose(tradeTime: string, closeTime: string | undefined): number | null {
  if (!closeTime) return null;
  const diff = new Date(closeTime).getTime() - new Date(tradeTime).getTime();
  return diff / 3_600_000;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function flagTrades(trades: TradeRecord[], market: MarketRecord): FlaggedTradeRow[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort((a, b) =>
    a.created_time < b.created_time ? -1 : 1,
  );

  const withHours = sorted.map((t) => ({
    trade: t,
    hours: hoursBeforeClose(t.created_time, market.close_time),
  }));

  // Volume spike: bucket by 1-hour slot, flag any slot with z-score > 2.0
  const hourBuckets = new Map<string, number>();
  for (const { trade } of withHours) {
    const hour = trade.created_time.slice(0, 13);
    hourBuckets.set(hour, (hourBuckets.get(hour) ?? 0) + Number(trade.volume_dollars ?? 0));
  }
  const bucketValues = [...hourBuckets.values()];
  const bucketMean = mean(bucketValues);
  const bucketStd = std(bucketValues, bucketMean);

  const spikeHours = new Set<string>();
  if (bucketStd > 0) {
    for (const [hour, vol] of hourBuckets.entries()) {
      if ((vol - bucketMean) / bucketStd > 2.0) spikeHours.add(hour);
    }
  }

  // Coordinated: trades with same taker_side within any 15-min window, cluster >= 2
  function windowKey(isoTime: string, side: string): string {
    const slot = Math.floor(new Date(isoTime).getTime() / (15 * 60_000));
    return `${side}:${slot}`;
  }

  const windowCounts = new Map<string, number>();
  for (const { trade } of withHours) {
    const key = windowKey(trade.created_time, trade.taker_side);
    windowCounts.set(key, (windowCounts.get(key) ?? 0) + 1);
  }

  const coordinatedWindows = new Set<string>(
    [...windowCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key]) => key),
  );

  return withHours.map(({ trade, hours }) => {
    const flags: TradeFlag[] = [];

    // Golden window: correct direction, low implied price, within 168h of close
    if (
      market.result &&
      trade.taker_side === market.result &&
      trade.yes_price < 45 &&
      hours !== null &&
      hours > 0 &&
      hours < 168
    ) {
      flags.push("golden_window");
    }

    if (coordinatedWindows.has(windowKey(trade.created_time, trade.taker_side))) {
      flags.push("coordinated");
    }

    if (spikeHours.has(trade.created_time.slice(0, 13))) {
      flags.push("volume_spike");
    }

    return { ...trade, hours_before_close: hours, flags };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FLAG_LABELS: Record<TradeFlag, string> = {
  coordinated: "COORD",
  golden_window: "GOLDEN",
  volume_spike: "SPIKE",
};

const FLAG_CHIP_COLORS: Record<TradeFlag, string> = {
  golden_window:
    "text-[var(--severity-critical)] border-[var(--severity-critical)]/30 bg-[var(--severity-critical-bg)]",
  coordinated:
    "text-[var(--severity-high)] border-[var(--severity-high)]/30 bg-[var(--severity-high-bg)]",
  volume_spike:
    "text-[var(--severity-medium)] border-[var(--severity-medium)]/30 bg-[var(--severity-medium-bg)]",
};

function rowBorderColor(flags: TradeFlag[]): string {
  if (flags.includes("golden_window")) return "var(--severity-critical)";
  if (flags.includes("coordinated")) return "var(--severity-high)";
  if (flags.includes("volume_spike")) return "var(--severity-medium)";
  return "transparent";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHours(h: number | null): string {
  if (h === null) return "n/a";
  if (h < 0) return "after close";
  return `${h.toFixed(1)}h`;
}

// ─── Trade volume chart ───────────────────────────────────────────────────────

function TradeVolumeChart({ rows }: { rows: FlaggedTradeRow[] }) {
  if (rows.length === 0) return null;

  // Bucket by hour, flag the bucket if any trade in it is suspicious
  const buckets = new Map<string, { volume: number; suspicious: boolean }>();
  for (const row of rows) {
    const hour = row.created_time.slice(0, 13);
    const existing = buckets.get(hour) ?? { volume: 0, suspicious: false };
    buckets.set(hour, {
      volume: existing.volume + Number(row.volume_dollars ?? 0),
      suspicious: existing.suspicious || row.flags.length > 0,
    });
  }

  const data = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([hour, { volume, suspicious }]) => ({
      hour: new Date(`${hour}:00:00Z`).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
      }),
      volume: Math.round(volume),
      suspicious,
    }));

  return (
    <div className="mb-5">
      <p className="mb-3 text-xs uppercase tracking-[0.14em] text-text-tertiary">
        Trade volume by hour
        <span className="ml-3 text-[var(--severity-critical)]">■</span>
        <span className="ml-1 text-text-muted">suspicious hour</span>
      </p>
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.07)" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fill: "#64748b", fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v}`}
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
              formatter={(value: number) => [`$${value.toLocaleString()}`, "volume"]}
            />
            <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.suspicious ? "var(--severity-critical)" : "var(--accent)"}
                  fillOpacity={entry.suspicious ? 0.9 : 0.6}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Filter row ───────────────────────────────────────────────────────────────

type FilterMode = "all" | "suspicious";

function FilterRow({
  mode,
  onMode,
  typeFilter,
  onType,
}: {
  mode: FilterMode;
  onMode: (m: FilterMode) => void;
  typeFilter: TradeFlag | null;
  onType: (t: TradeFlag | null) => void;
}) {
  const pill = "rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.15em] transition cursor-pointer";
  const active = "border-border-accent bg-[var(--accent-dim)] text-[var(--accent)]";
  const inactive =
    "border-border-default text-text-secondary hover:border-border-accent hover:text-text-primary";

  const types: TradeFlag[] = ["coordinated", "golden_window", "volume_spike"];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => onMode("all")} className={`${pill} ${mode === "all" ? active : inactive}`}>
        All
      </button>
      <button
        type="button"
        onClick={() => onMode("suspicious")}
        className={`${pill} ${mode === "suspicious" ? active : inactive}`}
      >
        Suspicious only
      </button>
      <span className="mx-1 h-4 w-px bg-border-default" />
      {types.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onType(typeFilter === t ? null : t)}
          className={`${pill} ${typeFilter === t ? active : inactive}`}
        >
          {FLAG_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

// ─── Trade table ──────────────────────────────────────────────────────────────

function TradeTable({
  rows,
  mode,
  typeFilter,
}: {
  rows: FlaggedTradeRow[];
  mode: FilterMode;
  typeFilter: TradeFlag | null;
}) {
  let visible = rows;
  if (mode === "suspicious") visible = visible.filter((r) => r.flags.length > 0);
  if (typeFilter) visible = visible.filter((r) => r.flags.includes(typeFilter));

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-default px-4 py-6 text-sm text-text-secondary">
        {rows.length === 0
          ? "No trades stored for this market. Run the ingest pipeline first."
          : "No trades match the current filter."}
      </div>
    );
  }

  const COLS = ["Time", "Price (YES%)", "Count", "Volume ($)", "Direction", "Hrs to close", "Flags"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default text-left">
            {COLS.map((h) => (
              <th
                key={h}
                className="pb-3 pr-4 font-mono text-xs uppercase tracking-[0.14em] text-text-tertiary last:pr-0"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const suspicious = row.flags.length > 0;
            const borderColor = rowBorderColor(row.flags);
            return (
              <tr
                key={row.trade_id}
                className="border-b border-border-default/50 hover:bg-bg-secondary"
                style={suspicious ? { borderLeft: `3px solid ${borderColor}` } : {}}
              >
                <td className="py-2.5 pr-4 font-mono text-xs text-text-secondary">
                  {formatTime(row.created_time)}
                </td>
                <td className="py-2.5 pr-4 font-mono text-text-primary">{row.yes_price}%</td>
                <td className="py-2.5 pr-4 font-mono text-text-primary">
                  {Number(row.count).toLocaleString()}
                </td>
                <td className="py-2.5 pr-4 font-mono text-text-primary">
                  ${Number(row.volume_dollars ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="py-2.5 pr-4">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      row.taker_side === "yes"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-[var(--severity-critical)]/30 bg-[var(--severity-critical-bg)] text-[var(--severity-critical)]"
                    }`}
                  >
                    {row.taker_side.toUpperCase()}
                  </span>
                </td>
                <td className="py-2.5 pr-4 font-mono text-xs text-text-secondary">
                  {formatHours(row.hours_before_close)}
                </td>
                <td className="py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {row.flags.length === 0 ? (
                      <span className="text-xs text-text-muted">—</span>
                    ) : (
                      row.flags.map((f) => (
                        <span
                          key={f}
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] ${FLAG_CHIP_COLORS[f]}`}
                        >
                          {FLAG_LABELS[f]}
                        </span>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Market result card ───────────────────────────────────────────────────────

function MarketCard({
  market,
  selected,
  onClick,
}: {
  market: MarketRecord;
  selected: boolean;
  onClick: () => void;
}) {
  const statusColors: Record<string, string> = {
    open: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    closed: "text-[var(--severity-medium)] border-[var(--severity-medium)]/30 bg-[var(--severity-medium-bg)]",
    settled: "border-border-default bg-bg-secondary text-text-secondary",
    finalized: "border-border-default bg-bg-secondary text-text-secondary",
  };
  const statusStyle = statusColors[market.status?.toLowerCase() ?? ""] ?? statusColors.settled;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[20px] border p-4 text-left transition duration-150 ${
        selected
          ? "border-border-accent bg-[var(--accent-dim)]"
          : "border-border-default bg-bg-secondary hover:border-border-accent"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text-primary">{market.title}</p>
          <p className="mt-0.5 font-mono text-xs text-text-tertiary">{market.ticker}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusStyle}`}>
            {market.status}
          </span>
          {market.result ? (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                market.result === "yes"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-[var(--severity-critical)]/30 bg-[var(--severity-critical-bg)] text-[var(--severity-critical)]"
              }`}
            >
              {market.result}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-text-secondary">
        <span>
          Vol: <span className="font-mono text-text-primary">${Math.round(market.volume ?? 0).toLocaleString()}</span>
        </span>
        {market.close_time ? (
          <span>
            Close:{" "}
            <span className="font-mono text-text-primary">
              {new Date(market.close_time).toLocaleDateString()}
            </span>
          </span>
        ) : null}
        {market.category ? (
          <span className="uppercase tracking-[0.12em] text-text-tertiary">{market.category}</span>
        ) : null}
      </div>
    </button>
  );
}

// ─── Trade inspector ──────────────────────────────────────────────────────────

function TradeInspector({ market, onClose }: { market: MarketRecord; onClose: () => void }) {
  const [flagged, setFlagged] = useState<FlaggedTradeRow[]>([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<FilterMode>("all");
  const [typeFilter, setTypeFilter] = useState<TradeFlag | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFlagged([]);
    setTotalTrades(0);

    getMarketTrades(market.ticker)
      .then((trades) => {
        if (!active) return;
        setTotalTrades(trades.length);
        setFlagged(flagTrades(trades, market));
      })
      .catch(() => {
        if (active) setError("Could not load trades for this market.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [market.ticker, market]);

  const suspiciousCount = flagged.filter((r) => r.flags.length > 0).length;

  return (
    <section className="panel">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Trade inspector</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-text-primary">
            {market.title}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="data-chip">{market.ticker}</span>
            <span className="data-chip uppercase">{market.status}</span>
            {market.result ? <span className="data-chip uppercase">result: {market.result}</span> : null}
            <span className="data-chip">${Math.round(market.volume ?? 0).toLocaleString()} vol</span>
            {!loading ? (
              <span className="data-chip">
                {totalTrades} trades · {suspiciousCount} suspicious
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full border border-border-default px-4 py-2 text-sm text-text-secondary transition hover:border-border-accent hover:text-text-primary">
          Close
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-secondary">Loading trades…</p>
      ) : error ? (
        <div className="rounded-2xl border border-border-default bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
          {error}
        </div>
      ) : (
        <>
          <TradeVolumeChart rows={flagged} />
          {totalTrades > 0 ? (
            <div className="mb-5">
              <FilterRow mode={mode} onMode={setMode} typeFilter={typeFilter} onType={setTypeFilter} />
            </div>
          ) : null}
          <TradeTable rows={flagged} mode={mode} typeFilter={typeFilter} />
        </>
      )}
    </section>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MarketSearch() {
  const [query, setQuery] = useState("");
  const [markets, setMarkets] = useState<MarketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MarketRecord | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let active = true;
      setLoading(true);
      setError(null);

      searchMarkets(query.trim() || undefined, 50)
        .then((data) => {
          if (!active) return;
          setMarkets(data);
          setSelected((prev) => {
            if (prev && !data.find((m) => m.ticker === prev.ticker)) return null;
            return prev;
          });
        })
        .catch(() => {
          if (active) setError("Search failed. Is the local API running?");
        })
        .finally(() => {
          if (active) setLoading(false);
        });

      return () => {
        active = false;
      };
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleSelect(market: MarketRecord) {
    setSelected((prev) => (prev?.ticker === market.ticker ? null : market));
    setTimeout(() => {
      inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <section className="panel">
        <p className="eyebrow">Local market store</p>
        <h1 className="mt-1 font-mono text-3xl font-semibold uppercase tracking-[-0.02em] text-text-primary">
          Market search
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
          Search ingested markets by title or ticker. Select one to inspect its trades and flag
          suspicious activity — coordinated clusters, golden-window bets, and volume spikes.
        </p>

        <div className="mt-6">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by market title or ticker…"
            className="w-full rounded-2xl border border-border-default bg-bg-secondary px-5 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-border-accent focus:outline-none"
          />
        </div>

        <p className="mt-2 text-xs text-text-tertiary">
          {loading
            ? "Searching…"
            : error
              ? error
              : `${markets.length} market${markets.length !== 1 ? "s" : ""} found`}
        </p>
      </section>

      {/* Results + Inspector */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.6fr)]">
        {/* Left: results list */}
        <div className="space-y-3">
          {!loading && markets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-default px-5 py-8 text-sm text-text-secondary">
              {query
                ? "No markets match your search. Try a broader term or ingest more markets first."
                : "No markets in the local store yet. Use Local Controls on the dashboard to ingest settled markets."}
            </div>
          ) : null}
          {markets.map((market) => (
            <MarketCard
              key={market.ticker}
              market={market}
              selected={selected?.ticker === market.ticker}
              onClick={() => handleSelect(market)}
            />
          ))}
        </div>

        {/* Right: inspector */}
        <div ref={inspectorRef}>
          {selected ? (
            <TradeInspector market={selected} onClose={() => setSelected(null)} />
          ) : (
            <div className="panel flex min-h-[240px] items-center justify-center">
              <p className="text-sm text-text-secondary">
                Select a market from the list to inspect its trades.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
