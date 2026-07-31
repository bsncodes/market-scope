import { Router } from 'express';
import { resourceNotFound } from '../errors';
import { requireId } from '../helpers/request';
import {
  countryExists,
  listCities,
  listCountries,
  listStates,
  stateExists,
} from '../repositories/location';
import { getCityBbox } from '../controllers/geocode';

export const locationRouter = Router();

locationRouter.get('/countries', async (_req, res) => {
  res.json(await listCountries());
});

locationRouter.get('/countries/:countryId/states', async (req, res) => {
  const countryId = requireId(req.params.countryId, 'countryId');
  if (!(await countryExists(countryId))) {
    throw resourceNotFound(`No country with id ${countryId}.`);
  }
  res.json(await listStates(countryId));
});

locationRouter.get('/states/:stateId/cities', async (req, res) => {
  const stateId = requireId(req.params.stateId, 'stateId');
  if (!(await stateExists(stateId))) {
    throw resourceNotFound(`No state with id ${stateId}.`);
  }
  res.json(await listCities(stateId));
});

locationRouter.get('/cities/:cityId/bbox', async (req, res) => {
  res.json(await getCityBbox(requireId(req.params.cityId, 'cityId')));
});
