import { Router } from 'express';
import multer from 'multer';
import { badRequest } from '../errors';
import { countPortfolioStores } from '../repositories/portfolio';
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
        badRequest(
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
    throw badRequest('No file uploaded. Attach a CSV as the "file" field.');
  }
  res
    .status(HttpStatus.Created)
    .json(await replacePortfolioFromCsv(req.file.buffer));
});

portfolioRouter.get('/summary', async (_req, res) => {
  res.json(await countPortfolioStores());
});
