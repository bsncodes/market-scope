import type { Bbox, DiscoveredStore, OsmTag } from '../types/discovery';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements?: OverpassElement[];
}

/** Parses `amenity=pharmacy` from the TEXT[] stored on category.value. */
export function parseOsmTag(expression: string): OsmTag {
  const index = expression.indexOf('=');
  if (index <= 0 || index === expression.length - 1) {
    throw new Error(
      `Malformed OSM tag expression "${expression}", expected key=value.`,
    );
  }
  return {
    key: expression.slice(0, index).trim(),
    value: expression.slice(index + 1).trim(),
  };
}

/**
 * Overpass takes a bbox as (south, west, north, east) — latitude first, the
 * opposite of the (x, y) ordering PostGIS uses.
 *
 * Nodes cover standalone POIs; ways and relations cover stores mapped as
 * building outlines. `out center` collapses those areas to a single point, so
 * every element yields coordinates without fetching full geometry.
 */
export function buildOverpassQuery(
  bbox: Bbox,
  tags: OsmTag[],
  timeoutSeconds: number,
  elementTypes: readonly string[] = ['node', 'way', 'relation'],
): string {
  if (tags.length === 0) {
    throw new Error('Cannot build an Overpass query with no tags.');
  }

  const box = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const clauses = tags
    .flatMap(({ key, value }) =>
      elementTypes.map(
        (element) => `  ${element}["${key}"="${value}"](${box});`,
      ),
    )
    .join('\n');

  return `[out:json][timeout:${timeoutSeconds}];\n(\n${clauses}\n);\nout center;`;
}

/**
 * Keeps only elements with usable coordinates. `osmElementId` is namespaced by
 * type because a node and a way can share a numeric id while being different
 * features — collapsing them would silently drop one during dedupe.
 */
export function parseOverpassResponse(
  response: OverpassResponse,
  tags: OsmTag[],
): DiscoveredStore[] {
  const stores: DiscoveredStore[] = [];

  for (const element of response.elements ?? []) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    stores.push({
      osmElementId: `${element.type}/${element.id}`,
      name: element.tags?.name ?? null,
      categoryValue: matchedTag(element.tags, tags),
      lat,
      lng,
    });
  }

  return stores;
}

// Which of the queried tags this element actually matched. Overpass does not
// say, so it is recovered from the element's own tags.
function matchedTag(
  elementTags: Record<string, string> | undefined,
  queried: OsmTag[],
): string {
  const matched = queried.find(
    ({ key, value }) => elementTags?.[key] === value,
  );
  const tag = matched ?? queried[0];
  return `${tag.key}=${tag.value}`;
}
