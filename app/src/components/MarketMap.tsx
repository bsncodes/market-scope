import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Popup,
  Rectangle,
  TileLayer,
} from 'react-leaflet';
import { boundsCentre } from '../lib/boundary';
import { categoryLabel } from '../lib/labels';
import type { LayerKey } from '../pages/DashboardPage';
import type { Bounds, DiscoveredStore, PortfolioStore } from '../types/api';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Layers stack, so the styles have to stay distinguishable when pins overlap:
 * different fill, different radius and different stroke, not just hue.
 */
const STYLE: Record<LayerKey, L.CircleMarkerOptions & { radius: number }> = {
  discovered: {
    radius: 5,
    color: '#1d4ed8',
    fillColor: '#60a5fa',
    weight: 1,
    fillOpacity: 0.85,
  },
  inside: {
    radius: 8,
    color: '#065f46',
    fillColor: '#10b981',
    weight: 2,
    fillOpacity: 0.9,
  },
  outside: {
    radius: 8,
    color: '#7c2d12',
    fillColor: '#f59e0b',
    weight: 2,
    fillOpacity: 0.9,
  },
};

interface Props {
  boundary: Bounds;
  discovered: DiscoveredStore[];
  portfolio: PortfolioStore[];
  visible: Record<LayerKey, boolean>;
}

export function MarketMap({ boundary, discovered, portfolio, visible }: Props) {
  const rectangle: [[number, number], [number, number]] = [
    [boundary.minLat, boundary.minLng],
    [boundary.maxLat, boundary.maxLng],
  ];

  return (
    <MapContainer
      className="map"
      bounds={rectangle}
      boundsOptions={{ padding: [30, 30] }}
      center={boundsCentre(boundary)}
      zoom={13}
      scrollWheelZoom
    >
      <TileLayer
        attribution={OSM_ATTRIBUTION}
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Rectangle
        bounds={rectangle}
        pathOptions={{
          color: '#334155',
          weight: 2,
          dashArray: '6 4',
          fill: false,
        }}
      />

      {visible.discovered &&
        discovered.map((store) => (
          <CircleMarker
            key={`d-${store.id}`}
            center={[store.lat, store.lng]}
            pathOptions={STYLE.discovered}
            radius={STYLE.discovered.radius}
          >
            <Popup>
              <strong>{store.name ?? 'Unnamed store'}</strong>
              <br />
              {categoryLabel(store.category)}
              <br />
              <span className="popup-meta">OpenStreetMap {store.id}</span>
            </Popup>
          </CircleMarker>
        ))}

      {portfolio
        .filter((store) => visible[store.is_inside ? 'inside' : 'outside'])
        .map((store) => {
          const layer: LayerKey = store.is_inside ? 'inside' : 'outside';
          return (
            <CircleMarker
              key={`p-${store.id}`}
              center={[store.lat, store.lng]}
              pathOptions={STYLE[layer]}
              radius={STYLE[layer].radius}
            >
              <Popup>
                <strong>{store.name}</strong>
                <br />
                {categoryLabel(store.category)}
                <br />
                <span className="popup-meta">
                  {store.is_inside ? 'Inside' : 'Outside'} the boundary
                  {store.address ? ` · ${store.address}` : ''}
                </span>
              </Popup>
            </CircleMarker>
          );
        })}
    </MapContainer>
  );
}
