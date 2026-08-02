import type { Bbox, DiscoveryProgress } from './discovery';
import type { MarketStatus } from './market';

export interface MarketDetail {
  id: number;
  status: MarketStatus;
  error: string | null;
  last_discovered_at: Date | null;
  progress: DiscoveryProgress | null;
  boundary: Bbox;
  city: {
    id: number;
    name: string;
    state: string;
    country: string;
  };
  categories: { id: number; label: string }[];
}

export interface DashboardStore {
  id: string;
  name: string | null;
  category: string | null;
  lat: number;
  lng: number;
}

export interface PortfolioStoreForMarket {
  id: number;
  name: string;
  category: string | null;
  address: string | null;
  is_inside: boolean;
  lat: number;
  lng: number;
}
