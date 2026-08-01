import assert from 'node:assert/strict';
import { parsePortfolioCsv } from '../../src/controllers/portfolio';
import { AppError } from '../../src/errors';
import { ErrorCode } from '../../src/types/error';
import { HttpStatus } from '../../src/types/http';

const HEADER =
  'store_name,address,city,state,country,category,latitude,longitude';

const csv = (...lines: string[]) => Buffer.from([HEADER, ...lines].join('\n'));

function expectRejection(buffer: Buffer, code: ErrorCode): AppError {
  try {
    parsePortfolioCsv(buffer);
  } catch (err) {
    assert.ok(err instanceof AppError, `expected AppError, got ${err}`);
    assert.equal(err.code, code);
    return err;
  }
  throw new Error('expected parsePortfolioCsv to throw, but it returned');
}

describe('parsePortfolioCsv', () => {
  describe('accepts valid files', () => {
    it('parses rows and normalises blanks to null', () => {
      const rows = parsePortfolioCsv(
        csv('Alpha Mart,12 MG Road,Bengaluru,Karnataka,India,Supermarket,,'),
      );

      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        store_name: 'Alpha Mart',
        address: '12 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        category: 'Supermarket',
        latitude: null,
        longitude: null,
      });
    });

    it('parses coordinates as numbers when present', () => {
      const rows = parsePortfolioCsv(
        csv('Alpha,1 St,B,K,India,Supermarket,12.9716,77.5946'),
      );
      assert.equal(rows[0].latitude, 12.9716);
      assert.equal(rows[0].longitude, 77.5946);
    });

    it('accepts headers regardless of case and spacing', () => {
      const rows = parsePortfolioCsv(
        Buffer.from(
          'Store Name,ADDRESS,City,State,Country,Category,Latitude,Longitude\n' +
            'Alpha,1 St,B,K,India,X,12.9,77.5',
        ),
      );
      assert.equal(rows[0].store_name, 'Alpha');
    });

    it('tolerates a UTF-8 BOM, which spreadsheet exports add', () => {
      const rows = parsePortfolioCsv(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          csv('Alpha,1 St,B,K,India,X,12.9,77.5'),
        ]),
      );
      assert.equal(rows[0].store_name, 'Alpha');
    });
  });

  describe('header validation', () => {
    it('names every missing required column', () => {
      const err = expectRejection(
        Buffer.from('store_name,city,state,country\nA,B,C,D'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      assert.match(err.message, /address/);
      assert.match(err.message, /category/);
      assert.deepEqual((err.details as { missing: string[] }).missing, [
        'address',
        'category',
      ]);
    });

    it('rejects duplicate columns, which would otherwise collapse silently', () => {
      const err = expectRejection(
        Buffer.from(
          'store_name,address,city,state,country,category,latitude,latitude\n' +
            'A,1 St,B,K,India,X,12.9,99.9',
        ),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      assert.match(err.message, /Duplicate column/);
    });

    // Ordering matters: reporting "no data rows" for a file whose columns are
    // wrong hides the actual problem.
    it('reports bad headers ahead of an empty body', () => {
      const err = expectRejection(
        Buffer.from('store_name,city,state,country,category\n'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      assert.match(err.message, /Missing required column/);
    });

    it('reports an empty body once the headers are valid', () => {
      const err = expectRejection(
        Buffer.from(`${HEADER}\n`),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      assert.match(err.message, /no data rows/);
    });
  });

  describe('row validation', () => {
    it('requires store_name', () => {
      const err = expectRejection(
        csv(',1 St,B,K,India,X,12.9,77.5'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { column: string }[] };
      assert.equal(errors[0].column, 'store_name');
    });

    it('requires an address when coordinates are absent', () => {
      const err = expectRejection(
        csv('Alpha,,B,K,India,X,,'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { column: string }[] };
      assert.equal(errors[0].column, 'address');
    });

    it('rejects a coordinate supplied without its pair', () => {
      const err = expectRejection(
        csv('Alpha,1 St,B,K,India,X,12.9,'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { message: string }[] };
      assert.match(errors[0].message, /must be provided together/);
    });

    it('collects every error rather than stopping at the first', () => {
      const err = expectRejection(
        csv(
          ',1 St,B,K,India,X,12.9,77.5',
          'Beta,2 St,B,K,India,X,999,77.5',
          'Gamma,3 St,B,K,India,X,abc,77.5',
        ),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const details = err.details as { error_count: number };
      assert.equal(details.error_count, 3);
    });

    it('rejects the entire file when a single row is bad', () => {
      const err = expectRejection(
        csv(
          'Alpha,1 St,B,K,India,X,12.9,77.5',
          'Beta,2 St,B,K,India,X,999,77.5',
        ),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      assert.match(err.message, /No stores were imported/);
    });
  });

  // Regression: row numbers were derived from the record index, but
  // skip_empty_lines removes blank lines from that array, so every row after a
  // blank line was reported one line early.
  describe('row numbers reference the real file line', () => {
    it('is unaffected by blank lines', () => {
      const err = expectRejection(
        Buffer.from(
          [
            HEADER, // line 1
            'Alpha,1 St,B,K,India,X,12.9,77.5', // line 2
            '', // line 3
            'Beta,2 St,B,K,India,X,999,77.5', // line 4
            '',
            '', // lines 5-6
            'Gamma,3 St,B,K,India,X,abc,77.5', // line 7
          ].join('\n'),
        ),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );

      const { errors } = err.details as { errors: { row: number }[] };
      assert.deepEqual(
        errors.map((e) => e.row),
        [4, 7],
      );
    });

    it('points at the first data row for a single-row file', () => {
      const err = expectRejection(
        csv(',1 St,B,K,India,X,12.9,77.5'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { row: number }[] };
      assert.equal(errors[0].row, 2);
    });
  });

  describe('unparseable input', () => {
    it('is reported as a malformed payload, not a validation failure', () => {
      const err = expectRejection(
        Buffer.from(`${HEADER}\n"unterminated,1 St,B,K,India,X,1,2\n`),
        ErrorCode.MALFORMED_PAYLOAD,
      );
      assert.equal(err.status, HttpStatus.BadRequest);
    });
  });
});
