import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';
import { MulterError } from 'multer';
import { AppError } from './errors';
import { ErrorCode } from './types/error';
import { HttpStatus } from './types/http';
import { apiRouter } from './routes';

const notFoundHandler: RequestHandler = (req, res) => {
  res.status(HttpStatus.NotFound).json({
    error: {
      code: ErrorCode.NotFound,
      message: `Cannot ${req.method} ${req.path}`,
    },
  });
};

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // Check 2 of the validation order: multer rejects oversized files before the
  // buffer is ever parsed.
  if (err instanceof MulterError) {
    const oversized = err.code === 'LIMIT_FILE_SIZE';
    res
      .status(oversized ? HttpStatus.PayloadTooLarge : HttpStatus.BadRequest)
      .json({
        error: {
          code: oversized
            ? ErrorCode.PayloadTooLarge
            : ErrorCode.ValidationError,
          message: oversized
            ? 'The file exceeds the 5 MB upload limit.'
            : err.message,
        },
      });
    return;
  }

  console.error(err);
  res.status(HttpStatus.InternalServerError).json({
    error: { code: ErrorCode.InternalError, message: 'Something went wrong.' },
  });
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
