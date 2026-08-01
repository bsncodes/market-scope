import { Worker } from 'bullmq';
import { runDiscovery } from './controllers/discovery';
import { createRedisConnection, DISCOVERY_QUEUE } from './queue';
import { setMarketStatus } from './repositories/market';
import type { DiscoveryJobData } from './types/discovery';

/**
 * Concurrency stays at 1. The external services are rate limited per process
 * anyway, so parallel jobs would queue behind the same limiter while making
 * failures harder to attribute.
 */
export function createDiscoveryWorker() {
  const worker = new Worker<DiscoveryJobData>(
    DISCOVERY_QUEUE,
    async (job) => runDiscovery(job.data.marketId),
    { connection: createRedisConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`discovery job ${job?.id} failed: ${err.message}`);

    // Only the final attempt is terminal. Marking the market failed earlier
    // would contradict a retry that is about to succeed.
    const attemptsExhausted =
      job && job.attemptsMade >= (job.opts.attempts ?? 1);
    if (attemptsExhausted && job) {
      void setMarketStatus(job.data.marketId, 'failed', err.message);
    }
  });

  worker.on('completed', (job) => {
    console.log(`discovery job ${job.id} completed`);
  });

  return worker;
}

// Started directly rather than imported: the API and the worker are separate
// processes so slow discovery never competes with request handling.
if (require.main === module) {
  const worker = createDiscoveryWorker();
  console.log(`discovery worker listening on "${DISCOVERY_QUEUE}"`);

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
