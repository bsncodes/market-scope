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

export type LayerKey = 'discovered' | 'inside' | 'outside';

const LAYERS: { key: LayerKey; label: string; swatch: string }[] = [
  { key: 'discovered', label: 'Discovered stores', swatch: 'discovered' },
  { key: 'inside', label: 'Portfolio inside boundary', swatch: 'inside' },
  { key: 'outside', label: 'Portfolio outside boundary', swatch: 'outside' },
];

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

  const market = useRequest(valid ? () => getMarket(id) : null, [id]);
  const discovered = useRequest(valid ? () => getDiscoveredStores(id) : null, [
    id,
  ]);
  const portfolio = useRequest(valid ? () => getMarketPortfolio(id) : null, [
    id,
  ]);

  // All on by default, and each toggles on its own — these are stackable
  // layers, not exclusive view modes.
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    discovered: true,
    inside: true,
    outside: true,
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
      const layer: LayerKey = store.is_inside ? 'inside' : 'outside';
      if (!visible[layer]) continue;
      rows.push({
        key: `p-${store.id}`,
        name: store.name,
        category: store.category,
        layer,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [discovered.data, portfolio.data, visible]);

  const error = market.error ?? discovered.error ?? portfolio.error;
  if (error) {
    return (
      <Layout step={3} title="Market dashboard">
        <ErrorBox error={error} />
      </Layout>
    );
  }

  if (!market.data) {
    return (
      <Layout step={3} title="Market dashboard">
        <div className="card">Loading market…</div>
      </Layout>
    );
  }

  const { city, categories, boundary, last_discovered_at } = market.data;

  return (
    <Layout
      step={3}
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
                <span className={`swatch swatch--${layer.swatch}`} />
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
                <span className={`swatch swatch--${entry.layer}`} />
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

          <Link className="button" to="/setup">
            Create another market
          </Link>
        </aside>

        <section className="dashboard__map">
          <MarketMap
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
    return portfolio.data?.outside_count ?? 0;
  }
}
