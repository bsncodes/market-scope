import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getMarketStatus } from '../api/endpoints';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { asApiError } from '../hooks/useRequest';
import type { MarketStatusResponse } from '../types/api';

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_INTERVAL_MS = 60_000;

// Discovery is paced at well under a request per second against Overpass, so a
// large market legitimately takes minutes. Past this we stop claiming progress
// is happening and say so, rather than spinning indefinitely.
const STALL_WARNING_MS = 5 * 60_000;

const isTerminal = (status: string) =>
  status === 'completed' || status === 'failed';

export function StatusPage() {
  const { marketId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<MarketStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [stalled, setStalled] = useState(false);

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
    let consecutiveFailures = 0;
    const startedAt = Date.now();

    async function poll() {
      try {
        const next = await getMarketStatus(id);
        if (!active) return;
        consecutiveFailures = 0;
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
        consecutiveFailures += 1;
        setError(asApiError(err));
      }

      if (!active) return;
      setStalled(Date.now() - startedAt > STALL_WARNING_MS);

      // Backing off on repeated failures stops a dead API being hammered every
      // ten seconds for as long as the tab is open. A success resets it, so a
      // single blip does not slow the rest of the run down.
      const backoff = Math.min(
        POLL_INTERVAL_MS * 2 ** consecutiveFailures,
        MAX_POLL_INTERVAL_MS,
      );
      timer = setTimeout(poll, backoff);
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
      step={3}
      title={failed ? 'Discovery failed' : 'Discovering stores'}
      subtitle={
        failed
          ? 'Nothing was imported for this market.'
          : 'Fetching OpenStreetMap tiles and locating your portfolio. This page refreshes every 10 seconds.'
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

        {stalled && !failed && (
          <div className="notice notice--warn">
            Still working after {Math.round(STALL_WARNING_MS / 60_000)} minutes.
            Large markets do take a while, but if the tile counts below are not
            moving, check that the discovery worker is running.
          </div>
        )}

        {status?.error && (
          <div
            className={failed ? 'notice notice--bad' : 'notice notice--warn'}
          >
            {status.error}
          </div>
        )}

        <div className="actions">
          {failed && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => navigate('/setup')}
            >
              Try a different market
            </button>
          )}
          <Link className="button" to="/">
            Back to dashboard
          </Link>
        </div>
      </section>
    </Layout>
  );
}
