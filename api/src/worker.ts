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

  // This handler is the only place that writes a terminal status on the throw
  // path: runDiscovery deliberately leaves it alone, because only the job
  // knows whether attempts remain.
  worker.on('failed', async (job, err) => {
    console.error(`discovery job ${job?.id} failed: ${err.message}`);
    if (!job) return;

    const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!attemptsExhausted) return;

    // Awaited rather than fire-and-forget: this is the last durable record of
    // what happened, and a shutdown right after could otherwise drop it,
    // leaving the market stuck in `processing` forever.
    try {
      await setMarketStatus(
        job.data.marketId,
        'failed',
        'Discovery could not be completed. Please try creating the market again.',
      );
    } catch (statusErr) {
      console.error(
        `could not mark market ${job.data.marketId} failed: ${(statusErr as Error).message}`,
      );
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
