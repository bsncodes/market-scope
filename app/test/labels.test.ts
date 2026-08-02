import { describe, expect, it } from 'vitest';
import { categoryLabel } from '../src/lib/labels';

describe('categoryLabel', () => {
  it('drops the OSM tag namespace', () => {
    expect(categoryLabel('amenity=pharmacy')).to.equal('Pharmacy');
    expect(categoryLabel('shop=supermarket')).to.equal('Supermarket');
  });

  it('turns an underscored value into words', () => {
    expect(categoryLabel('shop=department_store')).to.equal('Department Store');
    expect(categoryLabel('shop=mobile_phone')).to.equal('Mobile Phone');
  });

  // Portfolio rows carry a free-text category from the CSV, not a tag.
  it('passes through a value that has no namespace', () => {
    expect(categoryLabel('Supermarket')).to.equal('Supermarket');
    expect(categoryLabel('sweets & bakery')).to.equal('Sweets & bakery');
  });

  it('names the absence rather than rendering an empty cell', () => {
    expect(categoryLabel(null)).to.equal('Uncategorised');
  });

  it('does not throw on a trailing separator', () => {
    expect(categoryLabel('shop=')).to.equal('');
  });
});
