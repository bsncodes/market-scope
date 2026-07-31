import type { Pool } from 'pg';
import { CATEGORY_SEED } from './categories.data';

export async function seedCategories(pool: Pool): Promise<void> {
  for (const category of CATEGORY_SEED) {
    await pool.query(
      `INSERT INTO category (label, value)
       VALUES ($1, $2)
       ON CONFLICT (label) DO UPDATE SET value = EXCLUDED.value`,
      [category.label, category.value],
    );
  }
}
