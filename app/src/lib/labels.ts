/**
 * `amenity=pharmacy` is what OSM calls it and what the API stores, but a
 * retail analyst reading the list wants "Pharmacy". The value after the `=`
 * carries the meaning; the key is only the tag namespace.
 */
export function categoryLabel(raw: string | null): string {
  if (!raw) return 'Uncategorised';
  const value = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw;
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
