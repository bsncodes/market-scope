import { Link } from 'react-router-dom';
import { listMarkets } from '../api/endpoints';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { useRequest } from '../hooks/useRequest';
import type { MarketStatus } from '../types/api';

const dateFormat: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/** A queued or processing market goes back to its status view, not the dashboard. */
const destinationFor = (id: number, status: MarketStatus) =>
  status === 'completed' ? `/markets/${id}` : `/markets/${id}/status`;

export function MarketsPage() {
  const markets = useRequest(listMarkets, []);

  return (
    <Layout
      step={3}
      title="Markets"
      subtitle="Every market you have created, newest first. Reopen a completed one to see its dashboard again."
    >
      {markets.error && <ErrorBox error={markets.error} />}

      {markets.loading && <div className="card">Loading markets…</div>}

      {markets.data && markets.data.markets.length === 0 && (
        <div className="card">
          <p>No markets yet.</p>
          <div className="actions">
            <Link className="button button--primary" to="/setup">
              Create your first market
            </Link>
          </div>
        </div>
      )}

      {markets.data && markets.data.markets.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="markets">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Categories</th>
                  <th>Status</th>
                  <th className="markets__num">Area</th>
                  <th className="markets__num">Discovered</th>
                  <th className="markets__num">In / Out</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {markets.data.markets.map((market) => (
                  <tr key={market.id}>
                    <td>
                      <strong>{market.city.name}</strong>
                      <div className="markets__sub">
                        {market.city.state} · #{market.id}
                      </div>
                    </td>
                    <td className="markets__wrap">
                      {market.categories.map((c) => c.label).join(', ')}
                    </td>
                    <td>
                      <span className={`badge badge--${market.status}`}>
                        {market.status}
                      </span>
                      {market.error && (
                        <div className="markets__sub" title={market.error}>
                          {market.error}
                        </div>
                      )}
                    </td>
                    <td className="markets__num">
                      {market.area_sq_km.toFixed(1)} km²
                    </td>
                    <td className="markets__num">
                      {market.discovered_count ?? '—'}
                    </td>
                    <td className="markets__num">
                      {market.portfolio_inside} / {market.portfolio_outside}
                    </td>
                    <td title={new Date(market.created_at).toLocaleString()}>
                      {new Date(market.created_at).toLocaleDateString(
                        undefined,
                        dateFormat,
                      )}
                    </td>
                    <td>
                      <Link
                        className="button"
                        to={destinationFor(market.id, market.status)}
                      >
                        {market.status === 'completed' ? 'Open' : 'View'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {markets.data.count === markets.data.limit && (
            <p className="footnote">
              Showing the {markets.data.limit} most recent markets.
            </p>
          )}
        </>
      )}
    </Layout>
  );
}
