import assert from 'node:assert/strict';
import { pool } from '../../src/db';
import { ErrorCode } from '../../src/types/error';
import { clearPortfolio, countPortfolioRows } from '../helpers/db';
import { apiGet, apiPost, apiUpload } from '../helpers/testServer';

const HEADER =
  'store_name,address,city,state,country,category,latitude,longitude';
const csv = (...lines: string[]) => Buffer.from([HEADER, ...lines].join('\n'));

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const upload = <T = unknown>(body: Buffer, filename?: string, type?: string) =>
  apiUpload<T>('/api/portfolio/upload', body, filename, type);

describe('POST /api/portfolio/upload', () => {
  beforeEach(clearPortfolio);
  after(clearPortfolio);

  describe('successful upload', () => {
    it('persists rows and reports what still needs geocoding', async () => {
      const res = await upload(
        csv(
          'Alpha Mart,12 MG Road,Bengaluru,Karnataka,India,Supermarket,12.9716,77.5946',
          'Beta Pharmacy,45 Brigade Road,Bengaluru,Karnataka,India,Pharmacy,,',
        ),
      );

      assert.equal(res.status, 201);
      assert.deepEqual(res.body, {
        imported: 2,
        with_coordinates: 1,
        awaiting_geocoding: 1,
      });
      assert.equal(await countPortfolioRows(), 2);
    });

    it('leaves location NULL when coordinates were not supplied', async () => {
      await upload(
        csv(
          'Alpha,12 MG Road,Bengaluru,Karnataka,India,Supermarket,12.9716,77.5946',
          'Beta,45 Brigade Road,Bengaluru,Karnataka,India,Pharmacy,,',
        ),
      );

      const { rows } = await pool.query(
        'SELECT store_name, location FROM portfolio_store ORDER BY store_name',
      );
      assert.notEqual(rows[0].location, null, 'Alpha should be located');
      assert.equal(rows[1].location, null, 'Beta should await geocoding');
    });

    // ST_MakePoint takes (x, y). Reversing it is silent, so assert the stored
    // point rather than trusting the insert.
    it('stores longitude as X and latitude as Y', async () => {
      await upload(
        csv(
          'Alpha,12 MG Road,Bengaluru,Karnataka,India,Supermarket,12.9716,77.5946',
        ),
      );

      const { rows } = await pool.query(
        `SELECT ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
         FROM portfolio_store`,
      );
      assert.equal(Math.round(rows[0].lat * 1e4) / 1e4, 12.9716);
      assert.equal(Math.round(rows[0].lng * 1e4) / 1e4, 77.5946);
    });

    it('replaces the previous portfolio rather than appending', async () => {
      await upload(csv('Alpha,1 St,B,K,India,X,12.9,77.5'));
      await upload(
        csv(
          'Beta,2 St,B,K,India,X,12.9,77.5',
          'Gamma,3 St,B,K,India,X,12.9,77.5',
        ),
      );

      const { rows } = await pool.query(
        'SELECT store_name FROM portfolio_store ORDER BY store_name',
      );
      assert.deepEqual(
        rows.map((r) => r.store_name),
        ['Beta', 'Gamma'],
      );
    });
  });

  describe('rejection is atomic', () => {
    // Reject-whole-file only means anything if the existing portfolio survives.
    it('leaves the existing portfolio untouched when the new file is invalid', async () => {
      await upload(csv('Alpha,1 St,B,K,India,X,12.9,77.5'));
      assert.equal(await countPortfolioRows(), 1);

      const res = await upload(csv('Beta,2 St,B,K,India,X,999,77.5'));
      assert.equal(res.status, 422);

      const { rows } = await pool.query(
        'SELECT store_name FROM portfolio_store',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].store_name, 'Alpha');
    });

    it('imports nothing when only one row of many is bad', async () => {
      const res = await upload(
        csv(
          'Alpha,1 St,B,K,India,X,12.9,77.5',
          'Beta,2 St,B,K,India,X,12.9,77.5',
          'Gamma,3 St,B,K,India,X,999,77.5',
        ),
      );
      assert.equal(res.status, 422);
      assert.equal(await countPortfolioRows(), 0);
    });
  });

  describe('request-level rejection', () => {
    it('400s when no file is attached', async () => {
      const res = await apiPost<ErrorBody>('/api/portfolio/upload');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ErrorCode.REQUEST_VALIDATION_FAILED);
    });

    it('415s for a non-CSV file', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from('not a csv'),
        'notes.txt',
        'text/plain',
      );
      assert.equal(res.status, 415);
      assert.equal(res.body.error.code, ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    });

    it('413s when the file exceeds the size cap', async () => {
      const row =
        'Store,1 Long Street Name,Bengaluru,Karnataka,India,Supermarket,12.9,77.5\n';
      const big = Buffer.from(`${HEADER}\n${row.repeat(80_000)}`);
      assert.ok(big.byteLength > 5 * 1024 * 1024);

      const res = await upload<ErrorBody>(big, 'big.csv');
      assert.equal(res.status, 413);
      assert.equal(res.body.error.code, ErrorCode.PAYLOAD_TOO_LARGE);
    });
  });

  describe('content-level rejection', () => {
    it('422s and names a missing column', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from('store_name,city,state,country,category\nA,B,C,D,E'),
      );
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, ErrorCode.RESOURCE_VALIDATION_FAILED);
      assert.match(res.body.error.message, /address/);
    });

    it('422s on duplicate columns', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from(
          'store_name,address,city,state,country,category,latitude,latitude\n' +
            'A,1 St,B,K,India,X,12.9,99.9',
        ),
      );
      assert.equal(res.status, 422);
      assert.match(res.body.error.message, /Duplicate column/);
    });

    it('400s on a file that cannot be parsed at all', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from(`${HEADER}\n"unterminated,1 St,B,K,India,X,1,2\n`),
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ErrorCode.MALFORMED_PAYLOAD);
    });

    // Regression: row numbers were derived from the record index, which drifts
    // once skip_empty_lines removes blank lines from that array.
    it('reports every bad row with its real file line', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from(
          [
            HEADER, // 1
            'Alpha,1 St,B,K,India,X,12.9,77.5', // 2
            '', // 3
            'Beta,2 St,B,K,India,X,999,77.5', // 4
            '',
            '', // 5, 6
            'Gamma,3 St,B,K,India,X,abc,77.5', // 7
          ].join('\n'),
        ),
      );

      assert.equal(res.status, 422);
      const details = res.body.error.details as {
        error_count: number;
        errors: { row: number }[];
      };
      assert.equal(details.error_count, 2);
      assert.deepEqual(
        details.errors.map((e) => e.row),
        [4, 7],
      );
    });
  });
});

describe('GET /api/portfolio/summary', () => {
  after(clearPortfolio);

  it('returns numeric counts, not strings', async () => {
    await clearPortfolio();
    await upload(
      csv('Alpha,1 St,B,K,India,X,12.9,77.5', 'Beta,2 St,B,K,India,X,,'),
    );

    const res = await apiGet<{ total: number; located: number }>(
      '/api/portfolio/summary',
    );
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.total, 'number');
    assert.equal(typeof res.body.located, 'number');
    assert.deepEqual(res.body, { total: 2, located: 1 });
  });
});
