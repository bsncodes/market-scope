import L from 'leaflet';
import { useEffect, useRef } from 'react';
import {
  MapContainer,
  Marker,
  Rectangle,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { boundsCentre, normalizeBounds } from '../lib/boundary';
import type { Bounds } from '../types/api';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const handleIcon = (kind: 'corner' | 'move') =>
  L.divIcon({
    className: '',
    html: `<span class="map-handle map-handle--${kind}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const CORNER_ICON = handleIcon('corner');
const MOVE_ICON = handleIcon('move');

type Corner = 'sw' | 'nw' | 'ne' | 'se';

const cornerLatLng = (b: Bounds, corner: Corner): [number, number] =>
  ({
    sw: [b.minLat, b.minLng] as [number, number],
    nw: [b.maxLat, b.minLng] as [number, number],
    ne: [b.maxLat, b.maxLng] as [number, number],
    se: [b.minLat, b.maxLng] as [number, number],
  })[corner];

/** Moves only the edges the dragged corner touches, keeping the box axis-aligned. */
function withCorner(
  b: Bounds,
  corner: Corner,
  lat: number,
  lng: number,
): Bounds {
  switch (corner) {
    case 'sw':
      return { ...b, minLat: lat, minLng: lng };
    case 'nw':
      return { ...b, maxLat: lat, minLng: lng };
    case 'ne':
      return { ...b, maxLat: lat, maxLng: lng };
    case 'se':
      return { ...b, minLat: lat, maxLng: lng };
  }
}

/** Re-centres the view when the city changes, but not while the user drags. */
function RecentreOn({ bounds, token }: { bounds: Bounds; token: unknown }) {
  const map = useMap();

  // Kept in a ref so refitting depends on `token` alone — reacting to `bounds`
  // would yank the viewport on every drag frame. Assigned in an effect rather
  // than during render: a render must stay side-effect free to be safely
  // replayed, which Strict Mode and concurrent rendering both rely on.
  const latest = useRef(bounds);
  useEffect(() => {
    latest.current = bounds;
  });

  useEffect(() => {
    const b = latest.current;
    map.fitBounds(
      [
        [b.minLat, b.minLng],
        [b.maxLat, b.maxLng],
      ],
      { padding: [40, 40] },
    );
  }, [map, token]);

  return null;
}

interface Props {
  bounds: Bounds;
  onChange: (bounds: Bounds) => void;
  /** Changing this refits the view — the selected city id, in practice. */
  recentreToken: unknown;
  overLimit: boolean;
}

export function BoundaryEditor({
  bounds,
  onChange,
  recentreToken,
  overLimit,
}: Props) {
  // The centre at the moment the move-drag started. Deriving the delta from
  // the live bounds instead would compound rounding on every mouse move.
  const dragOrigin = useRef<{
    lat: number;
    lng: number;
    bounds: Bounds;
  } | null>(null);

  const rectangle: [[number, number], [number, number]] = [
    [bounds.minLat, bounds.minLng],
    [bounds.maxLat, bounds.maxLng],
  ];

  return (
    <MapContainer
      className="map"
      center={boundsCentre(bounds)}
      zoom={12}
      scrollWheelZoom
    >
      <TileLayer
        attribution={OSM_ATTRIBUTION}
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecentreOn bounds={bounds} token={recentreToken} />

      <Rectangle
        bounds={rectangle}
        pathOptions={{
          color: overLimit ? '#c0392b' : '#1d4ed8',
          weight: 2,
          fillOpacity: 0.08,
        }}
      />

      {(['sw', 'nw', 'ne', 'se'] as Corner[]).map((corner) => (
        <Marker
          key={corner}
          position={cornerLatLng(bounds, corner)}
          icon={CORNER_ICON}
          draggable
          eventHandlers={{
            drag: (event) => {
              const { lat, lng } = (event.target as L.Marker).getLatLng();
              onChange(normalizeBounds(withCorner(bounds, corner, lat, lng)));
            },
          }}
        />
      ))}

      <Marker
        position={boundsCentre(bounds)}
        icon={MOVE_ICON}
        draggable
        eventHandlers={{
          dragstart: (event) => {
            const { lat, lng } = (event.target as L.Marker).getLatLng();
            dragOrigin.current = { lat, lng, bounds };
          },
          drag: (event) => {
            const origin = dragOrigin.current;
            if (!origin) return;
            const { lat, lng } = (event.target as L.Marker).getLatLng();
            const dLat = lat - origin.lat;
            const dLng = lng - origin.lng;
            onChange({
              minLat: origin.bounds.minLat + dLat,
              maxLat: origin.bounds.maxLat + dLat,
              minLng: origin.bounds.minLng + dLng,
              maxLng: origin.bounds.maxLng + dLng,
            });
          },
          dragend: () => {
            dragOrigin.current = null;
          },
        }}
      />
    </MapContainer>
  );
}
