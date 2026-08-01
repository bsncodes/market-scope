import { config } from './config';
import { createServer } from './server';

createServer().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
