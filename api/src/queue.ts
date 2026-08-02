import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
import type { DiscoveryJobData } from './types/discovery';

export const DISCOVERY_QUEUE = 'market-discovery';

// BullMQ requires this to be null: with a retry limit, a blocking command that
// exhausts its retries would throw inside the worker's internal loop.
export const createRedisConnection = () =>
  new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

let queue: Queue<DiscoveryJobData> | undefined;

export function discoveryQueue(): Queue<DiscoveryJobData> {
  if (!queue) {
    queue = new Queue<DiscoveryJobData>(DISCOVERY_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: config.discoveryJobAttempts,
        backoff: { type: 'exponential', delay: config.discoveryJobBackoffMs },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

export async function closeQueue(): Promise<void> {
  if (!queue) return;
  await queue.close();
  queue = undefined;
}

/**
 * The job id is the market id, so a duplicate enqueue for the same market is
 * ignored rather than running discovery twice.
 */
export async function enqueueDiscovery(marketId: number): Promise<void> {
  await discoveryQueue().add(
    'discover',
    { marketId },
    { jobId: `market-${marketId}` },
  );
}
