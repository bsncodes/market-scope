import { describe, expect, it } from 'vitest';
import {
  areaSqKm,
  boundsCentre,
  fromCityBbox,
  MAX_AREA_SQ_KM,
  normalizeBounds,
  shrinkToLimit,
} from '../src/lib/boundary';
import type { Bounds } from '../src/types/api';

// Bengaluru's real bounding box, as Nominatim returns it. The numbers below
// are checked against it rather than against a synthetic square, because the
// bug this file exists to prevent is a boundary the API then rejects.
const BENGALURU = {
  min_lat: 12.8334905,
  min_lng: 77.4598797,
  max_lat: 13.1426196,
  max_lng: 77.7840639,
};

describe('areaSqKm', () => {
  it('measures a real city bbox in square kilometres', () => {
    expect(areaSqKm(fromCityBbox(BENGALURU))).to.be.closeTo(1207, 5);
  });

  // The whole reason turf is a dependency. Width x height in degrees is wrong
  // by a latitude-dependent factor, and at 13°N that is ~1.5% — enough to let
  // a boundary reading 29.9 actually be over the 30 sq km cap.
  it('disagrees with the naive degree product, in the safe direction', () => {
    const bounds = shrinkToLimit(fromCityBbox(BENGALURU));
    const KM_PER_DEGREE = 110.574;
    const naive =
      (bounds.maxLat - bounds.minLat) *
      KM_PER_DEGREE *
      ((bounds.maxLng - bounds.minLng) * KM_PER_DEGREE);

    expect(naive).to.be.greaterThan(areaSqKm(bounds));
    expect(naive / areaSqKm(bounds)).to.be.closeTo(1.015, 0.01);
  });

  it('scales with the square of a linear factor', () => {
    const one: Bounds = {
      minLat: 13,
      minLng: 77.5,
      maxLat: 13.01,
      maxLng: 77.51,
    };
    const two: Bounds = {
      minLat: 13,
      minLng: 77.5,
      maxLat: 13.02,
      maxLng: 77.52,
    };

    expect(areaSqKm(two) / areaSqKm(one)).to.be.closeTo(4, 0.01);
  });

  it('is unaffected by hemisphere', () => {
    const north: Bounds = {
      minLat: 13,
      minLng: 77.5,
      maxLat: 13.02,
      maxLng: 77.52,
    };
    const south: Bounds = {
      minLat: -13.02,
      minLng: -77.52,
      maxLat: -13,
      maxLng: -77.5,
    };

    expect(areaSqKm(south)).to.be.closeTo(areaSqKm(north), 0.01);
  });
});

describe('shrinkToLimit', () => {
  // A city is invariably far larger than the cap, so seeding the rectangle
  // with the raw bbox lands the user on a boundary they cannot submit, with
  // Create disabled and no explanation.
  it('brings a whole city under the cap', () => {
    const shrunk = shrinkToLimit(fromCityBbox(BENGALURU));

    expect(areaSqKm(shrunk)).to.be.at.most(MAX_AREA_SQ_KM);
    expect(areaSqKm(shrunk)).to.be.greaterThan(MAX_AREA_SQ_KM * 0.9);
  });

  it('keeps the centre where it was', () => {
    const original = fromCityBbox(BENGALURU);
    const [lat, lng] = boundsCentre(original);
    const [shrunkLat, shrunkLng] = boundsCentre(shrinkToLimit(original));

    expect(shrunkLat).to.be.closeTo(lat, 1e-9);
    expect(shrunkLng).to.be.closeTo(lng, 1e-9);
  });

  it('leaves a boundary already under the cap untouched', () => {
    const small: Bounds = {
      minLat: 13,
      minLng: 77.5,
      maxLat: 13.01,
      maxLng: 77.51,
    };
    expect(shrinkToLimit(small)).to.deep.equal(small);
  });

  it('preserves the aspect ratio rather than squaring the box off', () => {
    const wide = { min_lat: 12.9, min_lng: 77.0, max_lat: 13.0, max_lng: 78.0 };
    const original = fromCityBbox(wide);
    const shrunk = shrinkToLimit(original);

    const ratio = (b: Bounds) => (b.maxLng - b.minLng) / (b.maxLat - b.minLat);
    expect(ratio(shrunk)).to.be.closeTo(ratio(original), 1e-9);
  });
});

describe('normalizeBounds', () => {
  // Dragging a corner past its opposite inverts the box, which PostGIS
  // rejects outright — and a collapsed one cannot be grabbed again.
  it('swaps an inverted box rather than passing it on', () => {
    const fixed = normalizeBounds({
      minLat: 13.05,
      minLng: 77.6,
      maxLat: 13.0,
      maxLng: 77.5,
    });

    expect(fixed.minLat).to.be.lessThan(fixed.maxLat);
    expect(fixed.minLng).to.be.lessThan(fixed.maxLng);
  });

  it('gives a fully collapsed box a grabbable minimum span', () => {
    const fixed = normalizeBounds({
      minLat: 13,
      minLng: 77.5,
      maxLat: 13,
      maxLng: 77.5,
    });

    expect(fixed.maxLat).to.be.greaterThan(fixed.minLat);
    expect(fixed.maxLng).to.be.greaterThan(fixed.minLng);
  });

  it('leaves a well-formed box alone', () => {
    const good: Bounds = {
      minLat: 13,
      minLng: 77.5,
      maxLat: 13.02,
      maxLng: 77.52,
    };
    expect(normalizeBounds(good)).to.deep.equal(good);
  });

  // Whatever comes out has to satisfy the API's own validation, which rejects
  // minimums that are not strictly below maximums.
  it('always produces something the API would accept', () => {
    const hostile: Bounds[] = [
      { minLat: 13.05, minLng: 77.6, maxLat: 13.0, maxLng: 77.5 },
      { minLat: 13, minLng: 77.5, maxLat: 13, maxLng: 77.5 },
      { minLat: 13, minLng: 77.5, maxLat: 13.0000001, maxLng: 77.5000001 },
      { minLat: -13.02, minLng: -77.52, maxLat: -13.04, maxLng: -77.5 },
    ];

    for (const bounds of hostile) {
      const fixed = normalizeBounds(bounds);
      expect(fixed.minLat, JSON.stringify(bounds)).to.be.lessThan(fixed.maxLat);
      expect(fixed.minLng, JSON.stringify(bounds)).to.be.lessThan(fixed.maxLng);
    }
  });
});

describe('fromCityBbox', () => {
  it('maps the API snake_case shape onto the map shape', () => {
    expect(fromCityBbox(BENGALURU)).to.deep.equal({
      minLat: BENGALURU.min_lat,
      minLng: BENGALURU.min_lng,
      maxLat: BENGALURU.max_lat,
      maxLng: BENGALURU.max_lng,
    });
  });
});
