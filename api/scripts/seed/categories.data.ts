// Category label -> OSM tag expressions ("key=value"), verified against the
// OSM wiki (Key:shop / Key:amenity). One label can map to several tags.
export const CATEGORY_SEED: { label: string; value: string[] }[] = [
  { label: 'Supermarket', value: ['shop=supermarket'] },
  { label: 'Convenience Store', value: ['shop=convenience'] },
  { label: 'Pharmacy', value: ['amenity=pharmacy', 'shop=chemist'] },
  { label: 'Department Store', value: ['shop=department_store'] },
  { label: 'Clothing Store', value: ['shop=clothes'] },
  { label: 'Footwear Store', value: ['shop=shoes'] },
  { label: 'Electronics Store', value: ['shop=electronics'] },
  { label: 'Mobile Phone Shop', value: ['shop=mobile_phone'] },
  { label: 'Bakery', value: ['shop=bakery'] },
  { label: 'Hardware Store', value: ['shop=hardware'] },
  { label: 'Stationery Store', value: ['shop=stationery'] },
  { label: 'Bookstore', value: ['shop=books'] },
];
