import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getMarketStatus } from '../api/endpoints';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { asApiError } from '../hooks/useRequest';
import type { MarketStatusResponse } from '../types/api';

const POLL_INTERVAL_MS = 10_000;

const isTerminal = (status: string) =>
  status === 'completed' || status === 'failed';

export function StatusPage() {
  const { marketId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<MarketStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const id = Number(marketId);
    if (!Number.isInteger(id) || id <= 0) {
      setError(
        new ApiError(400, 'BAD_ID', `"${marketId}" is not a market id.`),
      );
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const next = await getMarketStatus(id);
        if (!active) return;
        setStatus(next);
        setError(null);
        if (next.status === 'completed') {
          navigate(`/markets/${id}`, { replace: true });
          return;
        }
        // A failed market stops here rather than navigating: the dashboard
        // would have nothing to show and a spinner would never resolve.
        if (next.status === 'failed') return;
      } catch (err) {
        if (!active) return;
        setError(asApiError(err));
      }
      if (active) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [marketId, navigate]);

  const failed = status?.status === 'failed';

  return (
    <Layout
      step={2}
      title={failed ? 'Discovery failed' : 'Discovering stores'}
      subtitle={
        failed
          ? 'Nothing was imported for this market.'
          : 'Fetching OpenStreetMap tiles and locating your portfolio. This page checks every 10 seconds.'
      }
    >
      {error && <ErrorBox error={error} />}

      <section className="card">
        <p className="status-line">
          Market #{marketId} —{' '}
          <span className={`badge badge--${status?.status ?? 'queued'}`}>
            {status?.status ?? 'loading'}
          </span>
        </p>

        {!failed && !isTerminal(status?.status ?? '') && (
          <div className="spinner" aria-label="Discovery in progress" />
        )}

        {status?.progress && (
          <dl className="progress">
            <div>
              <dt>Tiles</dt>
              <dd>
                {status.progress.tilesFetched + status.progress.tilesReused} /{' '}
                {status.progress.tilesTotal}
                {status.progress.tilesReused > 0 &&
                  ` (${status.progress.tilesReused} from cache)`}
              </dd>
            </div>
            <div>
              <dt>Stores found</dt>
              <dd>{status.progress.discoveredInBoundary}</dd>
            </div>
            <div>
              <dt>Portfolio geocoded</dt>
              <dd>
                {status.progress.geocodeResolved} /{' '}
                {status.progress.geocodeCandidates}
              </dd>
            </div>
            {status.progress.tilesFailed > 0 && (
              <div>
                <dt>Tiles failed</dt>
                <dd>{status.progress.tilesFailed}</dd>
              </div>
            )}
          </dl>
        )}

        {status?.error && (
          <div
            className={failed ? 'notice notice--bad' : 'notice notice--warn'}
          >
            {status.error}
          </div>
        )}

        {failed && (
          <div className="actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => navigate('/setup')}
            >
              Try a different market
            </button>
          </div>
        )}
      </section>
    </Layout>
  );
}
