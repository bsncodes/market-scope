import type { Bbox } from './discovery';

export type MarketStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface CreateMarketInput {
  cityId: number;
  categoryIds: number[];
  boundary: Bbox;
}

export interface Market {
  id: number;
  city_id: number;
  status: MarketStatus;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  last_discovered_at: Date | null;
}

export interface MarketStatusResponse {
  market_id: number;
  status: MarketStatus;
  error: string | null;
  last_discovered_at: string | null;
  progress: {
    tiles_total: number;
    tiles_fetched: number;
    tiles_reused: number;
    tiles_failed: number;
  } | null;
}
