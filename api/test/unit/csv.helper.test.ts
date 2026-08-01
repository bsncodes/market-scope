import assert from 'node:assert/strict';
import {
  blankToNull,
  findDuplicates,
  normalizeHeader,
  parseCoordinate,
} from '../../src/helpers/csv';
import type { RowError } from '../../src/types/portfolio';

describe('csv helpers', () => {
  describe('normalizeHeader', () => {
    it('lowercases and trims', () => {
      assert.equal(normalizeHeader('  Store_Name  '), 'store_name');
    });

    it('collapses internal whitespace into underscores', () => {
      assert.equal(normalizeHeader('store   name'), 'store_name');
      assert.equal(normalizeHeader('Store Name'), 'store_name');
    });
  });

  describe('blankToNull', () => {
    it('treats undefined, empty and whitespace-only as null', () => {
      assert.equal(blankToNull(undefined), null);
      assert.equal(blankToNull(''), null);
      assert.equal(blankToNull('   '), null);
    });

    it('trims surrounding whitespace but keeps content', () => {
      assert.equal(blankToNull('  Alpha Mart '), 'Alpha Mart');
    });

    it('preserves "0", which is falsy but meaningful', () => {
      assert.equal(blankToNull('0'), '0');
    });
  });

  describe('findDuplicates', () => {
    it('returns nothing when all values are unique', () => {
      assert.deepEqual(findDuplicates(['a', 'b', 'c']), []);
    });

    it('reports each duplicated value once, however many times it repeats', () => {
      assert.deepEqual(findDuplicates(['a', 'b', 'a', 'a', 'b']), ['a', 'b']);
    });
  });

  describe('parseCoordinate', () => {
    let errors: RowError[];
    beforeEach(() => {
      errors = [];
    });

    it('returns null without an error when the value is absent', () => {
      assert.equal(parseCoordinate('', 'latitude', 2, errors), null);
      assert.equal(errors.length, 0);
    });

    it('parses valid values, including negatives and zero', () => {
      assert.equal(parseCoordinate('12.9716', 'latitude', 2, errors), 12.9716);
      assert.equal(
        parseCoordinate('-77.5946', 'longitude', 2, errors),
        -77.5946,
      );
      assert.equal(parseCoordinate('0', 'latitude', 2, errors), 0);
      assert.equal(errors.length, 0);
    });

    it('accepts the exact boundary values', () => {
      assert.equal(parseCoordinate('90', 'latitude', 2, errors), 90);
      assert.equal(parseCoordinate('-90', 'latitude', 2, errors), -90);
      assert.equal(parseCoordinate('180', 'longitude', 2, errors), 180);
      assert.equal(parseCoordinate('-180', 'longitude', 2, errors), -180);
      assert.equal(errors.length, 0);
    });

    it('rejects latitude beyond +/-90', () => {
      assert.equal(parseCoordinate('90.1', 'latitude', 7, errors), null);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].row, 7);
      assert.equal(errors[0].column, 'latitude');
      assert.match(errors[0].message, /between -90 and 90/);
    });

    // A longitude of 100 is valid; the same value in the latitude column is
    // not. This is the check that catches a swapped lat/lng pair.
    it('applies a different limit per column', () => {
      assert.equal(parseCoordinate('100', 'longitude', 2, errors), 100);
      assert.equal(errors.length, 0);
      assert.equal(parseCoordinate('100', 'latitude', 2, errors), null);
      assert.equal(errors.length, 1);
    });

    it('rejects non-numeric text', () => {
      assert.equal(parseCoordinate('abc', 'latitude', 3, errors), null);
      assert.match(errors[0].message, /must be a number/);
    });

    it('rejects Infinity and NaN rather than letting Number() through', () => {
      assert.equal(parseCoordinate('Infinity', 'latitude', 3, errors), null);
      assert.equal(parseCoordinate('NaN', 'latitude', 3, errors), null);
      assert.equal(errors.length, 2);
    });
  });
});
