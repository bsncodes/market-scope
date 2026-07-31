import { Router } from 'express';
import { listCategories } from '../repositories/category';

export const categoryRouter = Router();

categoryRouter.get('/', async (_req, res) => {
  res.json(await listCategories());
});
