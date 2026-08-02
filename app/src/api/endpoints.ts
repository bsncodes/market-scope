import { get, postFile, postJson } from './client';
import type {
  Bounds,
  Category,
  City,
  CityBbox,
  Country,
  CreateMarketResponse,
  DiscoveredStoresResponse,
  MarketDetail,
  MarketListResponse,
  MarketStatusResponse,
  PortfolioResponse,
  State,
  UploadResult,
} from '../types/api';

export const uploadPortfolio = (file: File) =>
  postFile<UploadResult>('/portfolio/upload', file);

export const listCountries = () => get<Country[]>('/location/countries');

export const listStates = (countryId: number) =>
  get<State[]>(`/location/countries/${countryId}/states`);

export const listCities = (stateId: number) =>
  get<City[]>(`/location/states/${stateId}/cities`);

/** May take a second on a cache miss: it falls through to Nominatim. */
export const getCityBbox = (cityId: number) =>
  get<CityBbox>(`/location/cities/${cityId}/bbox`);

export const listCategories = () => get<Category[]>('/categories');

export const createMarket = (input: {
  cityId: number;
  categoryIds: number[];
  boundary: Bounds;
}) => postJson<CreateMarketResponse>('/markets', input);

export const listMarkets = () => get<MarketListResponse>('/markets');

export const getMarketStatus = (marketId: number) =>
  get<MarketStatusResponse>(`/markets/${marketId}/status`);

export const getMarket = (marketId: number) =>
  get<MarketDetail>(`/markets/${marketId}`);

export const getDiscoveredStores = (marketId: number) =>
  get<DiscoveredStoresResponse>(`/markets/${marketId}/discovered-stores`);

export const getMarketPortfolio = (marketId: number) =>
  get<PortfolioResponse>(`/markets/${marketId}/portfolio`);
