import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';
import { MulterError } from 'multer';
import {
  AppError,
  internalError,
  payloadTooLarge,
  requestValidationFailed,
  routeNotFound,
} from './errors';
import { apiRouter } from './routes';

const notFoundHandler: RequestHandler = (req, res, next) => {
  next(routeNotFound(`Cannot ${req.method} ${req.path}`));
};

function send(res: Parameters<ErrorRequestHandler>[2], err: AppError): void {
  res.status(err.status).json({
    error: { code: err.code, message: err.message, details: err.details },
  });
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    send(res, err);
    return;
  }

  // Check 2 of the validation order: multer rejects oversized files before the
  // buffer is ever parsed.
  if (err instanceof MulterError) {
    send(
      res,
      err.code === 'LIMIT_FILE_SIZE'
        ? payloadTooLarge('The file exceeds the 5 MB upload limit.')
        : requestValidationFailed(err.message),
    );
    return;
  }

  console.error(err);
  send(res, internalError('Something went wrong.'));
};

export function createServer() {
  const app = express();

  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
