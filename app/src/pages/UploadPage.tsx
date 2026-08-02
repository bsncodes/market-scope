import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ApiError } from '../api/client';
import { uploadPortfolio } from '../api/endpoints';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { asApiError } from '../hooks/useRequest';
import type { UploadResult } from '../types/api';

const COLUMNS =
  'store_name, address, city, state, country, category, and optionally latitude + longitude';

export function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await uploadPortfolio(file));
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Layout
      step={0}
      title="Upload your store portfolio"
      subtitle={`A CSV with ${COLUMNS}. Rows that already carry coordinates skip geocoding entirely.`}
    >
      <section className="card">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="file-input"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />

        <div className="actions">
          <button
            type="button"
            className="button button--primary"
            disabled={!file || uploading}
            onClick={submit}
          >
            {uploading ? 'Uploading…' : 'Upload portfolio'}
          </button>
          {result && (
            <button
              type="button"
              className="button"
              onClick={() => navigate('/setup')}
            >
              Continue to market setup →
            </button>
          )}
          <Link className="button" to="/markets">
            View existing markets
          </Link>
        </div>

        {error && <ErrorBox error={error} />}

        {result && (
          <div className="notice notice--ok">
            <strong>{result.imported} stores imported.</strong>{' '}
            {result.with_coordinates} already had coordinates;{' '}
            {result.awaiting_geocoding} will be geocoded during discovery.
          </div>
        )}
      </section>

      <p className="footnote">
        An upload replaces the previous portfolio. Any invalid row rejects the
        whole file — nothing is imported until every row is valid.
      </p>
    </Layout>
  );
}
