import { expect } from 'chai';
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
    // A real guard rather than an assertion: chai does not narrow types the
    // way node:assert's `asserts` signature did.
    if (!(err instanceof AppError)) {
      throw new Error(`expected an AppError, got ${String(err)}`);
    }
    expect(err.code).to.equal(code);
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

      expect(rows.length).to.equal(1);
      expect(rows[0]).to.deep.equal({
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
      expect(rows[0].latitude).to.equal(12.9716);
      expect(rows[0].longitude).to.equal(77.5946);
    });

    it('accepts headers regardless of case and spacing', () => {
      const rows = parsePortfolioCsv(
        Buffer.from(
          'Store Name,ADDRESS,City,State,Country,Category,Latitude,Longitude\n' +
            'Alpha,1 St,B,K,India,X,12.9,77.5',
        ),
      );
      expect(rows[0].store_name).to.equal('Alpha');
    });

    it('tolerates a UTF-8 BOM, which spreadsheet exports add', () => {
      const rows = parsePortfolioCsv(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          csv('Alpha,1 St,B,K,India,X,12.9,77.5'),
        ]),
      );
      expect(rows[0].store_name).to.equal('Alpha');
    });
  });

  describe('header validation', () => {
    it('names every missing required column', () => {
      const err = expectRejection(
        Buffer.from('store_name,city,state,country\nA,B,C,D'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      expect(err.message).to.match(/address/);
      expect(err.message).to.match(/category/);
      expect((err.details as { missing: string[] }).missing).to.deep.equal([
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
      expect(err.message).to.match(/Duplicate column/);
    });

    // Ordering matters: reporting "no data rows" for a file whose columns are
    // wrong hides the actual problem.
    it('reports bad headers ahead of an empty body', () => {
      const err = expectRejection(
        Buffer.from('store_name,city,state,country,category\n'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      expect(err.message).to.match(/Missing required column/);
    });

    it('reports an empty body once the headers are valid', () => {
      const err = expectRejection(
        Buffer.from(`${HEADER}\n`),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      expect(err.message).to.match(/no data rows/);
    });
  });

  describe('row validation', () => {
    it('requires store_name', () => {
      const err = expectRejection(
        csv(',1 St,B,K,India,X,12.9,77.5'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { column: string }[] };
      expect(errors[0].column).to.equal('store_name');
    });

    it('requires an address when coordinates are absent', () => {
      const err = expectRejection(
        csv('Alpha,,B,K,India,X,,'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { column: string }[] };
      expect(errors[0].column).to.equal('address');
    });

    it('rejects a coordinate supplied without its pair', () => {
      const err = expectRejection(
        csv('Alpha,1 St,B,K,India,X,12.9,'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { message: string }[] };
      expect(errors[0].message).to.match(/must be provided together/);
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
      expect(details.error_count).to.equal(3);
    });

    it('rejects the entire file when a single row is bad', () => {
      const err = expectRejection(
        csv(
          'Alpha,1 St,B,K,India,X,12.9,77.5',
          'Beta,2 St,B,K,India,X,999,77.5',
        ),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      expect(err.message).to.match(/No stores were imported/);
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
      expect(errors.map((e) => e.row)).to.deep.equal([4, 7]);
    });

    it('points at the first data row for a single-row file', () => {
      const err = expectRejection(
        csv(',1 St,B,K,India,X,12.9,77.5'),
        ErrorCode.RESOURCE_VALIDATION_FAILED,
      );
      const { errors } = err.details as { errors: { row: number }[] };
      expect(errors[0].row).to.equal(2);
    });
  });

  describe('unparseable input', () => {
    it('is reported as a malformed payload, not a validation failure', () => {
      const err = expectRejection(
        Buffer.from(`${HEADER}\n"unterminated,1 St,B,K,India,X,1,2\n`),
        ErrorCode.MALFORMED_PAYLOAD,
      );
      expect(err.status).to.equal(HttpStatus.BadRequest);
    });
  });
});
