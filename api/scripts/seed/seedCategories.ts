import type { PoolClient } from 'pg';
import { CATEGORY_SEED } from './categories.data';

export async function seedCategories(client: PoolClient): Promise<void> {
  for (const category of CATEGORY_SEED) {
    await client.query(
      `INSERT INTO category (label, value)
       VALUES ($1, $2)
       ON CONFLICT (label) DO UPDATE SET value = EXCLUDED.value`,
      [category.label, category.value],
    );
  }
}
