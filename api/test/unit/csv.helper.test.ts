import { expect } from 'chai';
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
      expect(normalizeHeader('  Store_Name  ')).to.equal('store_name');
    });

    it('collapses internal whitespace into underscores', () => {
      expect(normalizeHeader('store   name')).to.equal('store_name');
      expect(normalizeHeader('Store Name')).to.equal('store_name');
    });
  });

  describe('blankToNull', () => {
    it('treats undefined, empty and whitespace-only as null', () => {
      expect(blankToNull(undefined)).to.equal(null);
      expect(blankToNull('')).to.equal(null);
      expect(blankToNull('   ')).to.equal(null);
    });

    it('trims surrounding whitespace but keeps content', () => {
      expect(blankToNull('  Alpha Mart ')).to.equal('Alpha Mart');
    });

    it('preserves "0", which is falsy but meaningful', () => {
      expect(blankToNull('0')).to.equal('0');
    });
  });

  describe('findDuplicates', () => {
    it('returns nothing when all values are unique', () => {
      expect(findDuplicates(['a', 'b', 'c'])).to.deep.equal([]);
    });

    it('reports each duplicated value once, however many times it repeats', () => {
      expect(findDuplicates(['a', 'b', 'a', 'a', 'b'])).to.deep.equal([
        'a',
        'b',
      ]);
    });
  });

  describe('parseCoordinate', () => {
    let errors: RowError[];
    beforeEach(() => {
      errors = [];
    });

    it('returns null without an error when the value is absent', () => {
      expect(parseCoordinate('', 'latitude', 2, errors)).to.equal(null);
      expect(errors.length).to.equal(0);
    });

    it('parses valid values, including negatives and zero', () => {
      expect(parseCoordinate('12.9716', 'latitude', 2, errors)).to.equal(
        12.9716,
      );
      expect(parseCoordinate('-77.5946', 'longitude', 2, errors)).to.equal(
        -77.5946,
      );
      expect(parseCoordinate('0', 'latitude', 2, errors)).to.equal(0);
      expect(errors.length).to.equal(0);
    });

    it('accepts the exact boundary values', () => {
      expect(parseCoordinate('90', 'latitude', 2, errors)).to.equal(90);
      expect(parseCoordinate('-90', 'latitude', 2, errors)).to.equal(-90);
      expect(parseCoordinate('180', 'longitude', 2, errors)).to.equal(180);
      expect(parseCoordinate('-180', 'longitude', 2, errors)).to.equal(-180);
      expect(errors.length).to.equal(0);
    });

    it('rejects latitude beyond +/-90', () => {
      expect(parseCoordinate('90.1', 'latitude', 7, errors)).to.equal(null);
      expect(errors.length).to.equal(1);
      expect(errors[0].row).to.equal(7);
      expect(errors[0].column).to.equal('latitude');
      expect(errors[0].message).to.match(/between -90 and 90/);
    });

    // A longitude of 100 is valid; the same value in the latitude column is
    // not. This is the check that catches a swapped lat/lng pair.
    it('applies a different limit per column', () => {
      expect(parseCoordinate('100', 'longitude', 2, errors)).to.equal(100);
      expect(errors.length).to.equal(0);
      expect(parseCoordinate('100', 'latitude', 2, errors)).to.equal(null);
      expect(errors.length).to.equal(1);
    });

    it('rejects non-numeric text', () => {
      expect(parseCoordinate('abc', 'latitude', 3, errors)).to.equal(null);
      expect(errors[0].message).to.match(/must be a number/);
    });

    it('rejects Infinity and NaN rather than letting Number() through', () => {
      expect(parseCoordinate('Infinity', 'latitude', 3, errors)).to.equal(null);
      expect(parseCoordinate('NaN', 'latitude', 3, errors)).to.equal(null);
      expect(errors.length).to.equal(2);
    });
  });
});
