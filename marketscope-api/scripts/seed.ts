import { pool } from '../src/db';
import { seedCountry } from './seed/seedCountry';
import { seedStates } from './seed/seedStates';
import { seedCities } from './seed/seedCities';
import { seedCategories } from './seed/seedCategories';

async function main() {
  const countryId = await seedCountry(pool);
  console.log('Seeded country: India');

  const stateIdByStateCode = await seedStates(pool, countryId);
  console.log(`Seeded states: ${stateIdByStateCode.size}`);

  await seedCities(pool, stateIdByStateCode);
  console.log('Seeded cities');

  await seedCategories(pool);
  console.log('Seeded categories');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
