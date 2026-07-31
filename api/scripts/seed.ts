import { pool } from '../src/db';
import { seedCountry } from './seed/seedCountry';
import { seedStates } from './seed/seedStates';
import { seedCities } from './seed/seedCities';
import { seedCategories } from './seed/seedCategories';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const countryId = await seedCountry(client);
    console.log('Seeded country: India');

    const stateIdByStateCode = await seedStates(client, countryId);
    console.log(`Seeded states: ${stateIdByStateCode.size}`);

    await seedCities(client, stateIdByStateCode);
    console.log('Seeded cities');

    await seedCategories(client);
    console.log('Seeded categories');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
