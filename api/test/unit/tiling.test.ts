import { expect } from 'chai';
import {
  tileKeyAt,
  tileKeyToBbox,
  tileKeysForBbox,
  tileStepDegrees,
} from '../../src/helpers/tiling';

describe('tiling', () => {
  const step = tileStepDegrees(1);

  describe('tileStepDegrees', () => {
    it('converts km into a degree step', () => {
      expect(tileStepDegrees(110.574)).to.be.closeTo(1, 1e-9);
    });

    it('scales linearly with tile size', () => {
      expect(tileStepDegrees(2)).to.be.closeTo(tileStepDegrees(1) * 2, 1e-12);
    });

    it('rejects a non-positive size rather than producing an infinite grid', () => {
      expect(() => tileStepDegrees(0)).to.throw();
      expect(() => tileStepDegrees(-1)).to.throw();
    });
  });

  describe('tileKeyAt', () => {
    it('gives the same key for two points in one cell', () => {
      // Start from a cell origin so the offsets below cannot cross an edge.
      const latOrigin = Math.floor(12.9716 / step) * step;
      const lngOrigin = Math.floor(77.5946 / step) * step;

      const a = tileKeyAt(latOrigin + step * 0.1, lngOrigin + step * 0.1, step);
      const b = tileKeyAt(latOrigin + step * 0.9, lngOrigin + step * 0.9, step);
      expect(a).to.equal(b);
    });

    it('gives different keys either side of a cell edge', () => {
      const edge = Math.ceil(12.9716 / step) * step;
      expect(tileKeyAt(edge - step * 0.01, 77.5, step)).to.not.equal(
        tileKeyAt(edge + step * 0.01, 77.5, step),
      );
    });

    // Southern and western hemispheres must not collapse onto the same cell as
    // their mirror, which is what a truncating conversion would do.
    it('handles negative coordinates without folding onto positives', () => {
      expect(tileKeyAt(-12.9716, -77.5946, step)).to.not.equal(
        tileKeyAt(12.9716, 77.5946, step),
      );
      expect(tileKeyAt(-0.5 * step, 0.5 * step, step)).to.equal('-1:0');
    });
  });

  describe('tileKeyToBbox', () => {
    it('round-trips: a key contains the point it came from', () => {
      const lat = 12.9716;
      const lng = 77.5946;
      const bbox = tileKeyToBbox(tileKeyAt(lat, lng, step), step);

      expect(bbox.minLat).to.be.at.most(lat);
      expect(bbox.maxLat).to.be.at.least(lat);
      expect(bbox.minLng).to.be.at.most(lng);
      expect(bbox.maxLng).to.be.at.least(lng);
    });

    it('produces a cell exactly one step across', () => {
      const bbox = tileKeyToBbox('100:200', step);
      expect(bbox.maxLat - bbox.minLat).to.be.closeTo(step, 1e-12);
      expect(bbox.maxLng - bbox.minLng).to.be.closeTo(step, 1e-12);
    });

    it('rejects a malformed key instead of returning NaN bounds', () => {
      expect(() => tileKeyToBbox('not-a-key', step)).to.throw();
      expect(() => tileKeyToBbox('1:', step)).to.throw();
    });
  });

  describe('tileKeysForBbox', () => {
    it('returns a single tile for bounds inside one cell', () => {
      const keys = tileKeysForBbox(
        {
          minLat: 12.9,
          minLng: 77.5,
          maxLat: 12.9 + step * 0.5,
          maxLng: 77.5 + step * 0.5,
        },
        step,
      );
      expect(keys.length).to.equal(1);
    });

    it('covers every cell a wider boundary spans', () => {
      const base = Math.floor(12.9 / step) * step;
      const keys = tileKeysForBbox(
        {
          minLat: base + step * 0.5,
          minLng: 77.5,
          maxLat: base + step * 2.5,
          maxLng: 77.5 + step * 1.5,
        },
        step,
      );
      // Spans 3 rows and 2 columns.
      expect(keys.length).to.equal(6);
      expect(new Set(keys).size).to.equal(6);
    });

    // Over-inclusion is intentional: the exact shape is enforced later by
    // clipping, and a missing tile would silently lose stores.
    it('includes the tiles containing both corners', () => {
      const bounds = {
        minLat: 12.9,
        minLng: 77.5,
        maxLat: 12.9 + step * 2.2,
        maxLng: 77.5 + step * 2.2,
      };
      const keys = tileKeysForBbox(bounds, step);
      expect(keys).to.include(tileKeyAt(bounds.minLat, bounds.minLng, step));
      expect(keys).to.include(tileKeyAt(bounds.maxLat, bounds.maxLng, step));
    });

    it('every returned tile actually overlaps the bounds', () => {
      const bounds = {
        minLat: 12.9,
        minLng: 77.5,
        maxLat: 12.9 + step * 3,
        maxLng: 77.5 + step * 3,
      };
      for (const key of tileKeysForBbox(bounds, step)) {
        const tile = tileKeyToBbox(key, step);
        expect(tile.minLat).to.be.lessThan(bounds.maxLat + step);
        expect(tile.maxLat).to.be.greaterThan(bounds.minLat - step);
        expect(tile.minLng).to.be.lessThan(bounds.maxLng + step);
        expect(tile.maxLng).to.be.greaterThan(bounds.minLng - step);
      }
    });

    // Overlapping markets sharing tiles is the entire point of the cache.
    it('two overlapping boundaries share tiles', () => {
      const first = tileKeysForBbox(
        {
          minLat: 12.9,
          minLng: 77.5,
          maxLat: 12.9 + step * 3,
          maxLng: 77.5 + step * 3,
        },
        step,
      );
      const second = tileKeysForBbox(
        {
          minLat: 12.9 + step * 1.5,
          minLng: 77.5 + step * 1.5,
          maxLat: 12.9 + step * 4,
          maxLng: 77.5 + step * 4,
        },
        step,
      );
      const shared = second.filter((key) => first.includes(key));
      expect(shared.length).to.be.greaterThan(0);
    });

    it('refuses a boundary that would explode into too many tiles', () => {
      expect(() =>
        tileKeysForBbox(
          { minLat: -80, minLng: -170, maxLat: 80, maxLng: 170 },
          step,
        ),
      ).to.throw(/limit/);
    });
  });
});
