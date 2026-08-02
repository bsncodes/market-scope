import { expect } from 'chai';
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

      expect(res.status).to.equal(201);
      expect(res.body).to.deep.equal({
        imported: 2,
        with_coordinates: 1,
        awaiting_geocoding: 1,
        // Zero here because this spec has no markets; the reclassification
        // itself is covered in dashboard.routes.
        reclassified_markets: 0,
      });
      expect(await countPortfolioRows()).to.equal(2);
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
      expect(rows[0].location, 'Alpha should be located').to.not.equal(null);
      expect(rows[1].location, 'Beta should await geocoding').to.equal(null);
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
      expect(Math.round(rows[0].lat * 1e4) / 1e4).to.equal(12.9716);
      expect(Math.round(rows[0].lng * 1e4) / 1e4).to.equal(77.5946);
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
      expect(rows.map((r) => r.store_name)).to.deep.equal(['Beta', 'Gamma']);
    });
  });

  describe('rejection is atomic', () => {
    // Reject-whole-file only means anything if the existing portfolio survives.
    it('leaves the existing portfolio untouched when the new file is invalid', async () => {
      await upload(csv('Alpha,1 St,B,K,India,X,12.9,77.5'));
      expect(await countPortfolioRows()).to.equal(1);

      const res = await upload(csv('Beta,2 St,B,K,India,X,999,77.5'));
      expect(res.status).to.equal(422);

      const { rows } = await pool.query(
        'SELECT store_name FROM portfolio_store',
      );
      expect(rows.length).to.equal(1);
      expect(rows[0].store_name).to.equal('Alpha');
    });

    it('imports nothing when only one row of many is bad', async () => {
      const res = await upload(
        csv(
          'Alpha,1 St,B,K,India,X,12.9,77.5',
          'Beta,2 St,B,K,India,X,12.9,77.5',
          'Gamma,3 St,B,K,India,X,999,77.5',
        ),
      );
      expect(res.status).to.equal(422);
      expect(await countPortfolioRows()).to.equal(0);
    });
  });

  describe('request-level rejection', () => {
    it('400s when no file is attached', async () => {
      const res = await apiPost<ErrorBody>('/api/portfolio/upload');
      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal(ErrorCode.REQUEST_VALIDATION_FAILED);
    });

    it('415s for a non-CSV file', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from('not a csv'),
        'notes.txt',
        'text/plain',
      );
      expect(res.status).to.equal(415);
      expect(res.body.error.code).to.equal(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    });

    it('413s when the file exceeds the size cap', async () => {
      const row =
        'Store,1 Long Street Name,Bengaluru,Karnataka,India,Supermarket,12.9,77.5\n';
      const big = Buffer.from(`${HEADER}\n${row.repeat(80_000)}`);
      expect(big.byteLength).to.be.greaterThan(5 * 1024 * 1024);

      const res = await upload<ErrorBody>(big, 'big.csv');
      expect(res.status).to.equal(413);
      expect(res.body.error.code).to.equal(ErrorCode.PAYLOAD_TOO_LARGE);
    });
  });

  describe('content-level rejection', () => {
    it('422s and names a missing column', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from('store_name,city,state,country,category\nA,B,C,D,E'),
      );
      expect(res.status).to.equal(422);
      expect(res.body.error.code).to.equal(
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      expect(res.body.error.message).to.match(/address/);
    });

    it('422s on duplicate columns', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from(
          'store_name,address,city,state,country,category,latitude,latitude\n' +
            'A,1 St,B,K,India,X,12.9,99.9',
        ),
      );
      expect(res.status).to.equal(422);
      expect(res.body.error.message).to.match(/Duplicate column/);
    });

    it('400s on a file that cannot be parsed at all', async () => {
      const res = await upload<ErrorBody>(
        Buffer.from(`${HEADER}\n"unterminated,1 St,B,K,India,X,1,2\n`),
      );
      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal(ErrorCode.MALFORMED_PAYLOAD);
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

      expect(res.status).to.equal(422);
      const details = res.body.error.details as {
        error_count: number;
        errors: { row: number }[];
      };
      expect(details.error_count).to.equal(2);
      expect(details.errors.map((e) => e.row)).to.deep.equal([4, 7]);
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
    expect(res.status).to.equal(200);
    expect(typeof res.body.total).to.equal('number');
    expect(typeof res.body.located).to.equal('number');
    expect(res.body).to.deep.equal({ total: 2, located: 1 });
  });
});
