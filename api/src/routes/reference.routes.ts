import { Router } from 'express';
import { badRequest } from '../errors';
import {
  listCategories,
  listCities,
  listCountries,
  listStates,
} from '../repositories/reference.repo';
import { getCityBbox } from '../services/geocode.service';

export const referenceRouter = Router();

function requireIntParam(raw: unknown, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(
      'invalid_parameter',
      `${name} must be a positive integer.`,
    );
  }
  return value;
}

referenceRouter.get('/countries', async (_req, res) => {
  res.json(await listCountries());
});

referenceRouter.get('/states', async (req, res) => {
  const countryId = requireIntParam(req.query.country_id, 'country_id');
  res.json(await listStates(countryId));
});

referenceRouter.get('/cities', async (req, res) => {
  const stateId = requireIntParam(req.query.state_id, 'state_id');
  res.json(await listCities(stateId));
});

referenceRouter.get('/categories', async (_req, res) => {
  res.json(await listCategories());
});

referenceRouter.get('/cities/:id/bbox', async (req, res) => {
  const cityId = requireIntParam(req.params.id, 'id');
  res.json(await getCityBbox(cityId));
});
