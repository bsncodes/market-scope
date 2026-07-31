import { pool } from '../db';
import type { Category } from '../types/category';

// `value` holds the OSM tag expressions used by discovery and is deliberately
// not exposed to clients.
export async function listCategories(): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    'SELECT id, label FROM category ORDER BY label',
  );
  return rows;
}
