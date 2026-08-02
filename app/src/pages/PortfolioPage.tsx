import { Link } from 'react-router-dom';
import { listPortfolio } from '../api/endpoints';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { useRequest } from '../hooks/useRequest';

/** What is actually in portfolio_store right now, straight from the table. */
export function PortfolioPage() {
  const portfolio = useRequest('portfolio', listPortfolio);

  const stores = portfolio.data?.stores ?? [];
  const located = stores.filter((s) => s.lat !== null).length;

  return (
    <Layout
      step={1}
      title="Portfolio"
      subtitle="The stores currently held in the database. Uploading again replaces all of them."
    >
      {portfolio.error && <ErrorBox error={portfolio.error} />}
      {portfolio.loading && <div className="card">Loading portfolio…</div>}

      {portfolio.data && stores.length === 0 && (
        <div className="card">
          <p>No portfolio uploaded yet.</p>
          <div className="actions">
            <Link className="button button--primary" to="/upload">
              Upload a portfolio
            </Link>
          </div>
        </div>
      )}

      {stores.length > 0 && (
        <>
          <div className="actions actions--lead">
            <span className="footnote">
              <strong>{stores.length}</strong> stores · {located} located ·{' '}
              {stores.length - located} awaiting geocoding
            </span>
            <Link className="button" to="/upload">
              Replace portfolio
            </Link>
          </div>

          <div className="table-scroll">
            <table className="markets">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Category</th>
                  <th>Address</th>
                  <th>City</th>
                  <th className="markets__num">Latitude</th>
                  <th className="markets__num">Longitude</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td className="markets__wrap">{store.store_name}</td>
                    <td>{store.category ?? '—'}</td>
                    <td className="markets__wrap">{store.address ?? '—'}</td>
                    <td>{store.city ?? '—'}</td>
                    <td className="markets__num">
                      {store.lat?.toFixed(5) ?? (
                        <span className="footnote">to geocode</span>
                      )}
                    </td>
                    <td className="markets__num">
                      {store.lng?.toFixed(5) ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {portfolio.data?.count === portfolio.data?.limit && (
            <p className="footnote">
              Showing the first {portfolio.data?.limit} rows.
            </p>
          )}
        </>
      )}
    </Layout>
  );
}
