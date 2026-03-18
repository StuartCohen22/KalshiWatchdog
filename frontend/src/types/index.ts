export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface DashboardStats {
  trades_ingested: number;
  markets_monitored: number;
  anomalies_flagged: number;
  critical_alerts: number;
  detection_rate: number;
}

export interface TradeRecord {
  ticker: string;
  created_time: string;
  trade_id: string;
  yes_price: number;
  no_price: number;
  count: number;
  taker_side: "yes" | "no";
  volume_dollars: number;
}

export interface MarketRecord {
  ticker: string;
  event_ticker?: string;
  title: string;
  status: string;
  result?: "yes" | "no";
  close_time?: string;
  volume?: number;
  last_price?: number;
  category?: string;
  subtitle?: string;
  open_time?: string;
  expiration_time?: string;
}

export type TradeFlag = "coordinated" | "golden_window" | "volume_spike";

export interface FlaggedTradeRow extends TradeRecord {
  hours_before_close: number | null;
  flags: TradeFlag[];
}

export interface FlaggedTrade {
  trade_id: string;
  price_cents: number;
  count: number;
  hours_before: number;
  score: number;
  created_time: string;
}

export interface AnomalyRecord {
  anomaly_id: string;
  ticker: string;
  market_title: string;
  anomaly_type: "volume_spike" | "golden_window" | "coordinated";
  severity: Severity;
  anomaly_hour?: string;
  cluster_start?: string;
  cluster_end?: string;
  cluster_direction?: "yes" | "no";
  z_score?: number;
  trade_count: number;
  total_volume: number;
  hours_before_resolution?: number | null;
  pre_trade_prob?: number | null;
  resolution?: "yes" | "no";
  llm_summary?: string;
  llm_reasoning?: string;
  explanations?: string[];
  flagged_trades?: FlaggedTrade[];
  candidate_only?: boolean;
  detected_at: string;
}

export interface AnomalyDetailResponse {
  anomaly: AnomalyRecord;
  market: MarketRecord | null;
}

export interface KnownCase {
  id: string;
  title: string;
  date: string;
  subject: string;
  platform: string;
  summary: string;
  pattern: string;
  penalty: string;
  markets: string[];
  notes: string;
}

export interface HistoricalParallel {
  id: string;
  title: string;
  pattern: string;
  score: number;
}

export interface ReconMarket {
  ticker: string;
  event_ticker?: string;
  title: string;
  subtitle?: string;
  display_title?: string;
  display_context?: string;
  status: string;
  close_time?: string;
  volume: number;
  volume_24h?: number;
  display_volume?: number;
  display_volume_label?: string;
  last_price: number;
  implied_price?: number;
  yes_bid?: number;
  yes_ask?: number;
  category?: string;
  risk_label: "heightened" | "watch" | "baseline";
  historical_parallels: HistoricalParallel[];
}

export interface LocalStorageStatus {
  backend: string;
  local_data_dir: string;
  tables: {
    trades: string;
    markets: string;
    anomalies: string;
  };
}

export interface LocalActionResult {
  statusCode?: number;
  ingested?: number;
  status?: string;
  ticker?: string | null;
  hours_back?: number;
  anomalies_found?: number;
  processed_markets?: number;
  candidate_markets?: number;
  stored_trade_tickers?: number;
  selection_reason?: string;
  detection_profile?: string;
  message?: string;
  summary?: Array<{
    ticker: string;
    market_title: string;
    anomalies: number;
  }>;
}
