import type { ApiError } from '../api/client';
import type { RowError, UploadErrorDetails } from '../types/api';

const isRowError = (value: unknown): value is RowError =>
  typeof value === 'object' && value !== null && 'row' in value;

/**
 * The upload endpoint rejects a whole file but reports every bad row, so a user
 * can fix all of them in one pass. Collapsing that into the summary message
 * would throw away the only part that tells them what to change.
 */
export function ErrorBox({ error }: { error: ApiError }) {
  const details = (error.details ?? {}) as UploadErrorDetails;
  const rows = Array.isArray(details.errors)
    ? details.errors.filter(isRowError)
    : [];

  return (
    <div className="error-box" role="alert">
      <p className="error-box__message">{error.message}</p>

      {details.expected && (
        <p className="error-box__hint">
          Expected columns: {details.expected.join(', ')}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <table className="error-box__rows">
            <thead>
              <tr>
                <th>Line</th>
                <th>Column</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.row}-${row.column}-${index}`}>
                  <td>{row.row}</td>
                  <td>{row.column ?? '—'}</td>
                  <td>{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {details.truncated && (
            <p className="error-box__hint">
              Showing the first {rows.length} of {details.error_count} problems.
            </p>
          )}
        </>
      )}
    </div>
  );
}
