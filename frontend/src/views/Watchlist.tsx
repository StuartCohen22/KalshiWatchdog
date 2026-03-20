import { useCallback, useEffect, useRef, useState } from "react";

import {
  addToWatchlist,
  browseMarkets,
  getCategories,
  getWatchlist,
  removeFromWatchlist,
} from "../api/client";
import type { MarketRecord, WatchlistItem } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeUntil(iso: string | undefined): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "closed";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.ceil(diff / 60_000)}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-green-500/30 text-green-400",
  settled: "border-yellow-500/30 text-yellow-400",
  finalized: "border-yellow-500/30 text-yellow-400",
  closed: "border-red-500/30 text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_COLORS[status] ?? "border-border-default text-text-tertiary"}`}
    >
      {status}
    </span>
  );
}

// ─── Browse Card ──────────────────────────────────────────────────────────────

function BrowseCard({
  market,
  watched,
  onAdd,
}: {
  market: MarketRecord;
  watched: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-default bg-bg-secondary px-4 py-3 transition hover:border-border-accent">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{market.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          {market.category && (
            <span className="rounded-full border border-border-default px-2 py-0.5 text-[10px] uppercase tracking-wider">
              {market.category}
            </span>
          )}
          <StatusBadge status={market.status} />
          {market.last_price != null && (
            <span className="font-mono">{market.last_price}c</span>
          )}
          {(market.volume ?? 0) > 0 && (
            <span className="font-mono">vol {Number(market.volume).toLocaleString()}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={watched}
        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          watched
            ? "border-green-500/30 text-green-400 cursor-default"
            : "border-border-accent text-[var(--accent)] hover:bg-[var(--accent-dim)]"
        }`}
      >
        {watched ? "Watching" : "+ Watch"}
      </button>
    </div>
  );
}

// ─── Watchlist Card ───────────────────────────────────────────────────────────

function WatchlistCard({
  item,
  onRemove,
}: {
  item: WatchlistItem;
  onRemove: () => void;
}) {
  const m = item.market;
  return (
    <div className="rounded-2xl border border-border-default bg-bg-secondary p-4 transition hover:border-border-accent">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">
            {m?.title ?? item.ticker}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
            {item.category && (
              <span className="rounded-full border border-border-default px-2 py-0.5 text-[10px] uppercase tracking-wider">
                {item.category}
              </span>
            )}
            {m && <StatusBadge status={m.status} />}
            {m?.last_price != null && (
              <span className="font-mono">{m.last_price}c</span>
            )}
            {(m?.volume ?? 0) > 0 && (
              <span className="font-mono">vol {Number(m!.volume).toLocaleString()}</span>
            )}
            {m?.status === "open" && m?.close_time && (
              <span className="font-mono text-text-secondary">
                closes {timeUntil(m.close_time)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {item.has_anomaly && (
            <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
              {item.anomaly_count} anomal{item.anomaly_count === 1 ? "y" : "ies"}
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-border-default p-1.5 text-text-tertiary transition hover:border-red-500/40 hover:text-red-400"
            title="Remove from watchlist"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {item.notes && (
        <p className="mt-2 text-xs italic text-text-tertiary">{item.notes}</p>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function Watchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [browseResults, setBrowseResults] = useState<MarketRecord[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watchedTickers = new Set(watchlist.map((w) => w.ticker));

  const refreshWatchlist = useCallback(() => {
    getWatchlist().then(setWatchlist).catch(() => undefined);
  }, []);

  // Load watchlist + categories on mount
  useEffect(() => {
    refreshWatchlist();
    getCategories().then(setCategories).catch(() => undefined);
  }, [refreshWatchlist]);

  // Browse markets with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setBrowseLoading(true);
      browseMarkets({
        category: selectedCategory ?? undefined,
        status: selectedStatus || undefined,
        q: searchQuery.trim() || undefined,
        limit: 40,
      })
        .then(setBrowseResults)
        .catch(() => setBrowseResults([]))
        .finally(() => setBrowseLoading(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedCategory, selectedStatus, searchQuery]);

  async function handleAdd(market: MarketRecord) {
    await addToWatchlist(market.ticker, market.category);
    refreshWatchlist();
  }

  async function handleRemove(ticker: string) {
    await removeFromWatchlist(ticker);
    refreshWatchlist();
  }

  return (
    <div className="space-y-6">
      {/* ── My Watchlist ── */}
      <section className="panel">
        <p className="eyebrow">Personal tracking</p>
        <h1 className="mt-1 font-mono text-3xl font-semibold uppercase tracking-[-0.02em] text-text-primary">
          Watchlist
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
          Markets you're personally tracking. Anomaly flags from detection are highlighted automatically.
        </p>

        <div className="mt-6">
          {watchlist.length === 0 ? (
            <div className="flex h-[140px] items-center justify-center rounded-2xl border border-dashed border-border-default">
              <p className="text-sm text-text-secondary">
                No markets watchlisted yet. Browse below to add some.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {watchlist.map((item) => (
                <WatchlistCard
                  key={item.ticker}
                  item={item}
                  onRemove={() => handleRemove(item.ticker)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Browse & Add ── */}
      <section className="panel">
        <p className="eyebrow">Browse markets</p>
        <h2 className="mt-1 font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
          Find markets to watch
        </h2>

        {/* Filters */}
        <div className="mt-4 space-y-3">
          {/* Search */}
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title or ticker..."
            className="w-full rounded-2xl border border-border-default bg-bg-secondary px-5 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-border-accent focus:outline-none"
          />

          {/* Status toggles */}
          <div className="flex flex-wrap gap-2">
            {["open", "settled", "finalized", ""].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSelectedStatus(s)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  selectedStatus === s
                    ? "border-border-accent bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "border-border-default text-text-secondary hover:border-border-accent"
                }`}
              >
                {s || "All"}
              </button>
            ))}
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  !selectedCategory
                    ? "border-border-accent bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "border-border-default text-text-tertiary hover:border-border-accent"
                }`}
              >
                All categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    selectedCategory === cat
                      ? "border-border-accent bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "border-border-default text-text-tertiary hover:border-border-accent"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="mt-4">
          <p className="mb-3 text-xs text-text-tertiary">
            {browseLoading
              ? "Loading..."
              : `${browseResults.length} market${browseResults.length !== 1 ? "s" : ""}`}
          </p>

          {!browseLoading && browseResults.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center rounded-2xl border border-dashed border-border-default">
              <p className="text-sm text-text-secondary">
                No markets found. Try adjusting your filters or ingesting more markets.
              </p>
            </div>
          ) : (
            <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
              {browseResults.map((market) => (
                <BrowseCard
                  key={market.ticker}
                  market={market}
                  watched={watchedTickers.has(market.ticker)}
                  onAdd={() => handleAdd(market)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
