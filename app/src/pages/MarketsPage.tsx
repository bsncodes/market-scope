import { Link } from 'react-router-dom';
import { getPortfolioSummary, listMarkets } from '../api/endpoints';
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
  const portfolio = useRequest(getPortfolioSummary, []);

  // Uploading is a one-off, not a toll on every market. With a portfolio
  // already loaded, Create market goes straight to defining the boundary;
  // replacing it is a deliberate act, reached from the Portfolio view.
  const hasPortfolio = (portfolio.data?.total ?? 0) > 0;
  const createDestination = hasPortfolio ? '/setup' : '/upload';

  return (
    <Layout
      step={0}
      title="Dashboard"
      subtitle="Every market you have created, newest first. Reopen a completed one to see its map again."
    >
      <div className="actions" style={{ marginTop: 0, marginBottom: 18 }}>
        <Link className="button button--primary" to={createDestination}>
          Create market
        </Link>
        {hasPortfolio ? (
          <span className="footnote">
            Using the {portfolio.data?.total} stores already uploaded ·{' '}
            <Link to="/upload">replace them</Link>
          </span>
        ) : (
          !portfolio.loading && (
            <span className="footnote">
              You will be asked for a store portfolio first.
            </span>
          )
        )}
      </div>

      {markets.error && <ErrorBox error={markets.error} />}

      {markets.loading && <div className="card">Loading markets…</div>}

      {markets.data && markets.data.markets.length === 0 && (
        <div className="card">
          <p>
            No markets yet.{' '}
            {hasPortfolio
              ? 'Draw a boundary to discover what is around your stores.'
              : 'Upload a store portfolio, then draw a boundary to discover what is around it.'}
          </p>
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
