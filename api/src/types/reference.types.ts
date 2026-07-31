export interface Country {
  id: number;
  name: string;
  iso_code: string;
}

export interface State {
  id: number;
  name: string;
  code: string;
}

export interface City {
  id: number;
  name: string;
}

export interface Category {
  id: number;
  label: string;
}

export interface CityBbox {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
}

export interface CityForGeocoding {
  id: number;
  name: string;
  state_name: string;
  country_name: string;
  bbox: CityBbox | null;
}
