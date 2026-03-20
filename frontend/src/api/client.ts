import type {
  AnomalyDetailResponse,
  AnomalyRecord,
  DashboardStats,
  KnownCase,
  LocalActionResult,
  LocalStorageStatus,
  MarketRecord,
  ReconMarket,
  TradeRecord,
  WatchlistItem,
} from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function getIdToken(): Promise<string | null> {
  try {
    const { fetchAuthSession } = await import("aws-amplify/auth");
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken();
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...(await authHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getStats() {
  return request<DashboardStats>("/api/stats");
}

export function getAnomalies(severity?: string, limit = 50) {
  const params = new URLSearchParams();
  if (severity) params.set("severity", severity);
  params.set("limit", String(limit));
  return request<AnomalyRecord[]>(`/api/anomalies?${params}`);
}

export function getAnomaly(anomalyId: string) {
  return request<AnomalyDetailResponse>(`/api/anomalies/${anomalyId}`);
}

export function getMarketTrades(ticker: string) {
  return request<TradeRecord[]>(`/api/markets/${encodeURIComponent(ticker)}/trades`);
}

export function getKnownCases() {
  return request<KnownCase[]>("/api/known-cases");
}

export function getReconMarkets(status = "open", limit = 10) {
  return request<ReconMarket[]>(`/api/kalshi/recon?status=${encodeURIComponent(status)}&limit=${limit}`);
}

export function getStorageStatus() {
  return request<LocalStorageStatus>("/api/local/storage-status");
}

export function resetAnomalies() {
  return post<LocalActionResult>("/api/local/reset-anomalies");
}

export function resetLocalData() {
  return post<{ backend: string; local_data_dir: string }>("/api/local/reset");
}

export function ingestLocalMarkets(status = "settled", hoursBack = 720, limit = 200) {
  return post<LocalActionResult>("/api/local/ingest-markets", { status, hours_back: hoursBack, limit });
}

export function ingestLocalTrades(
  hoursBack = 720,
  ticker?: string,
  options?: { settledOnly?: boolean; marketLimit?: number; allHistory?: boolean; force?: boolean },
) {
  return post<LocalActionResult>("/api/local/ingest-trades", {
    hours_back: hoursBack,
    ticker,
    settled_only: options?.settledOnly ?? false,
    market_limit: options?.marketLimit ?? 25,
    all_history: options?.allHistory ?? false,
    force: options?.force ?? false,
  });
}

export function runLocalDetection(limit = 20, analyzeWithLlm = true) {
  return post<LocalActionResult>("/api/local/run-detection", {
    limit,
    analyze_with_llm: analyzeWithLlm,
  });
}

export interface CandlestickData {
  end_period_ts: number;
  price: {
    close_dollars: string;
    high_dollars: string;
    low_dollars: string;
    mean_dollars: string;
    open_dollars: string;
  };
  volume_fp: string;
}

export function getCandlesticks(
  ticker: string,
  startTs: number,
  endTs: number,
  periodInterval = 1440,
) {
  return request<{ candlesticks: CandlestickData[]; ticker: string }>(
    `/api/kalshi/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=${periodInterval}`,
  );
}

export interface MarketExplanation {
  headline: string;
  context: string;
  watch_for: string;
}

export function explainMarket(market: object) {
  return post<MarketExplanation>("/api/kalshi/explain-market", { market });
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface OrderbookResponse {
  orderbook_fp?: {
    yes_dollars?: [string, string][];
    no_dollars?: [string, string][];
  };
}

export function getOrderbook(ticker: string) {
  return request<OrderbookResponse>(`/api/kalshi/markets/${encodeURIComponent(ticker)}/orderbook`);
}

export interface RunRecord {
  ran_at: string;
  processed_markets: number;
  anomalies_found: number;
  candidate_markets: number;
  stored_trade_tickers: number;
  detection_profile: string;
  selection_reason: string;
}

export function getRunHistory(limit = 20) {
  return request<RunRecord[]>(`/api/local/run-history?limit=${limit}`);
}

export function scanMarket(ticker: string) {
  return post<LocalActionResult>("/api/local/ingest-trades", {
    ticker,
    hours_back: 720,
    settled_only: false,
    market_limit: 1,
    all_history: true,
  });
}

export function searchMarkets(q?: string, limit = 20): Promise<MarketRecord[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("limit", String(limit));
  return request<MarketRecord[]>(`/api/local/markets?${params}`);
}

// ── Watchlist ──────────────────────────────────────────────────────────────

export function getWatchlist() {
  return request<WatchlistItem[]>("/api/watchlist");
}

export function addToWatchlist(ticker: string, category?: string, notes?: string) {
  return post<{ ok: boolean }>("/api/watchlist", { ticker, category, notes });
}

export function removeFromWatchlist(ticker: string) {
  return getIdToken().then((token) =>
    fetch(`${API_BASE_URL}/api/watchlist/${encodeURIComponent(ticker)}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).then((r) => {
      if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
    }),
  );
}

export function getCategories() {
  return request<string[]>("/api/markets/categories");
}

export function browseMarkets(opts: {
  category?: string;
  status?: string;
  q?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts.category) params.set("category", opts.category);
  if (opts.status) params.set("status", opts.status);
  if (opts.q) params.set("q", opts.q);
  params.set("limit", String(opts.limit ?? 50));
  return request<MarketRecord[]>(`/api/markets/browse?${params}`);
}
