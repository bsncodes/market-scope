import { Router } from 'express';
import { categoryRouter } from './category';
import { locationRouter } from './location';
import { marketRouter } from './market';
import { portfolioRouter } from './portfolio';

// Every route lives under /api. Each router owns its own prefix, so paths are
// declared in one place rather than repeated on each handler.
export const apiRouter = Router();

apiRouter.use('/location', locationRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/portfolio', portfolioRouter);
apiRouter.use('/markets', marketRouter);
