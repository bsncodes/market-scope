import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getDiscoveredStores,
  getMarket,
  getMarketPortfolio,
} from '../api/endpoints';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { MarketMap } from '../components/MarketMap';
import { useRequest } from '../hooks/useRequest';
import { categoryLabel } from '../lib/labels';
import type { PortfolioStore } from '../types/api';

export type LayerKey = 'discovered' | 'inside' | 'outside' | 'matched';

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'discovered', label: 'Discovered stores' },
  { key: 'inside', label: 'Portfolio inside boundary' },
  { key: 'outside', label: 'Portfolio outside boundary' },
  { key: 'matched', label: 'Already on OpenStreetMap' },
];

// A matched store is still inside or outside the boundary, so it belongs to
// two layers at once. It renders once, styled by the more specific of the two:
// "OSM already knows about this shop" is the more interesting fact, so it wins
// while that layer is on. Turning it off returns the store to its
// inside/outside styling rather than hiding it.
const layerFor = (store: PortfolioStore, matchedVisible: boolean): LayerKey =>
  store.matched && matchedVisible
    ? 'matched'
    : store.is_inside
      ? 'inside'
      : 'outside';

// Inside and outside are the analytical point of this screen, and green
// against amber is exactly the pair red/green colour blindness collapses. The
// swatch keeps the map legend, the tag carries the meaning without it.
const LAYER_TAG: Record<LayerKey, string> = {
  discovered: 'OSM',
  inside: 'In',
  outside: 'Out',
  matched: 'Match',
};

export interface ListEntry {
  key: string;
  name: string;
  category: string | null;
  layer: LayerKey;
}

export function DashboardPage() {
  const { marketId } = useParams();
  const id = Number(marketId);
  const valid = Number.isInteger(id) && id > 0;

  const market = useRequest(`market:${id}`, valid ? () => getMarket(id) : null);
  const discovered = useRequest(
    `discovered:${id}`,
    valid ? () => getDiscoveredStores(id) : null,
  );
  const portfolio = useRequest(
    `market-portfolio:${id}`,
    valid ? () => getMarketPortfolio(id) : null,
  );

  // All on by default, and each toggles on its own — these are stackable
  // layers, not exclusive view modes.
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    discovered: true,
    inside: true,
    outside: true,
    matched: true,
  });

  const entries = useMemo<ListEntry[]>(() => {
    const rows: ListEntry[] = [];
    if (visible.discovered) {
      for (const store of discovered.data?.stores ?? []) {
        rows.push({
          key: `d-${store.id}`,
          name: store.name ?? 'Unnamed store',
          category: store.category,
          layer: 'discovered',
        });
      }
    }
    for (const store of portfolio.data?.stores ?? []) {
      const home: LayerKey = store.is_inside ? 'inside' : 'outside';
      const matched = store.matched && visible.matched;
      // Visible if either layer it belongs to is on.
      if (!visible[home] && !matched) continue;
      rows.push({
        key: `p-${store.id}`,
        name: store.name,
        category: store.category,
        layer: layerFor(store, visible.matched),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [discovered.data, portfolio.data, visible]);

  const error = market.error ?? discovered.error ?? portfolio.error;
  if (error) {
    return (
      <Layout step={0} title="Market dashboard">
        <ErrorBox error={error} />
      </Layout>
    );
  }

  if (!market.data) {
    return (
      <Layout step={0} title="Market dashboard">
        <div className="card">Loading market…</div>
      </Layout>
    );
  }

  const { city, categories, boundary, last_discovered_at } = market.data;

  return (
    <Layout
      step={0}
      title={`${city.name} market`}
      subtitle={
        <>
          {city.state}, {city.country} ·{' '}
          {categories.map((c) => c.label).join(', ')}
          {' · '}
          <span className="discovered-at">
            {last_discovered_at
              ? `Discovered ${new Date(last_discovered_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
              : 'Not yet discovered'}
          </span>
        </>
      }
    >
      {market.data.error && (
        <div className="notice notice--warn">{market.data.error}</div>
      )}

      <div className="dashboard">
        <aside className="dashboard__panel">
          <h2 className="panel-title">Layers</h2>
          <div className="checklist">
            {LAYERS.map((layer) => (
              <label key={layer.key} className="checklist__item">
                <input
                  type="checkbox"
                  checked={visible[layer.key]}
                  onChange={(event) =>
                    setVisible((current) => ({
                      ...current,
                      [layer.key]: event.target.checked,
                    }))
                  }
                />
                <span className={`swatch swatch--${layer.key}`} aria-hidden />
                {layer.label}
                <span className="checklist__count">{count(layer.key)}</span>
              </label>
            ))}
          </div>

          <h2 className="panel-title">
            Stores <span className="panel-title__count">{entries.length}</span>
          </h2>
          <ul className="store-list">
            {entries.map((entry) => (
              <li key={entry.key} className="store-list__item">
                <span className={`swatch swatch--${entry.layer}`} aria-hidden />
                <span
                  className={`store-list__tag store-list__tag--${entry.layer}`}
                >
                  {LAYER_TAG[entry.layer]}
                </span>
                <span className="store-list__name">{entry.name}</span>
                <span className="store-list__category">
                  {categoryLabel(entry.category)}
                </span>
              </li>
            ))}
            {entries.length === 0 && (
              <li className="store-list__empty">
                No stores in the layers you have switched on.
              </li>
            )}
          </ul>

          <div className="actions">
            <Link className="button button--primary" to="/upload">
              New market
            </Link>
            <Link className="button" to="/">
              All markets
            </Link>
          </div>
        </aside>

        <section className="dashboard__map">
          {/* MapContainer reads its bounds only when Leaflet is constructed,
              so without a key the viewport would stay on whichever market
              rendered first if this component were ever reused across ids. */}
          <MarketMap
            key={id}
            boundary={boundary}
            discovered={discovered.data?.stores ?? []}
            portfolio={portfolio.data?.stores ?? []}
            visible={visible}
          />
        </section>
      </div>
    </Layout>
  );

  function count(layer: LayerKey): number {
    if (layer === 'discovered') return discovered.data?.count ?? 0;
    if (layer === 'inside') return portfolio.data?.inside_count ?? 0;
    if (layer === 'outside') return portfolio.data?.outside_count ?? 0;
    return portfolio.data?.matched_count ?? 0;
  }
}
