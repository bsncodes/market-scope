import { Router } from 'express';
import multer from 'multer';
import { requestValidationFailed, unsupportedMediaType } from '../errors';
import {
  countPortfolioStores,
  listPortfolioStores,
} from '../repositories/portfolio';
import { replacePortfolioFromCsv } from '../controllers/portfolio';
import { HttpStatus } from '../types/http';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Held in memory because the file is size-capped and parsed in one pass. A
// production version would stream to disk to bound memory on large uploads.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  // Check 1 of the validation order: file type, before anything is read.
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream' ||
      file.originalname.toLowerCase().endsWith('.csv');

    if (!isCsv) {
      cb(
        unsupportedMediaType(
          `Only .csv files are accepted, received "${file.originalname}".`,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

export const portfolioRouter = Router();

portfolioRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    throw requestValidationFailed(
      'No file uploaded. Attach a CSV as the "file" field.',
    );
  }
  res
    .status(HttpStatus.Created)
    .json(await replacePortfolioFromCsv(req.file.buffer));
});

portfolioRouter.get('/summary', async (_req, res) => {
  res.json(await countPortfolioStores());
});

const MAX_PORTFOLIO_PAGE = 1000;

portfolioRouter.get('/', async (req, res) => {
  const limit = parsePortfolioLimit(req.query.limit);
  const stores = await listPortfolioStores(limit);
  res.json({ count: stores.length, limit, stores });
});

function parsePortfolioLimit(raw: unknown): number {
  if (raw === undefined) return 200;

  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PORTFOLIO_PAGE) {
    throw requestValidationFailed(
      `limit must be an integer between 1 and ${MAX_PORTFOLIO_PAGE}.`,
    );
  }
  return limit;
}
