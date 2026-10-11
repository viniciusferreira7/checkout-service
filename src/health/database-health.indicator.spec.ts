import type { DataSource } from 'typeorm';
import {
  DATABASE_CHECK_TIMEOUT_MS,
  DatabaseHealthIndicator,
} from './database-health.indicator';

function indicatorFor(query: () => Promise<unknown>) {
  return new DatabaseHealthIndicator({ query } as unknown as DataSource);
}

describe('DatabaseHealthIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports up when SELECT 1 answers', async () => {
    await expect(
      indicatorFor(async () => [{ '?column?': 1 }]).check()
    ).resolves.toMatchObject({ status: 'up' });
  });

  it('reports down when the query fails', async () => {
    await expect(
      indicatorFor(() => Promise.reject(new Error('refused'))).check()
    ).resolves.toMatchObject({ status: 'down' });
  });

  it('reports down instead of hanging when the database never answers', async () => {
    vi.useFakeTimers();

    const pending = indicatorFor(
      () =>
        new Promise(() => {
          // never settles: a database that accepted the connection and hung
        })
    ).check();

    await vi.advanceTimersByTimeAsync(DATABASE_CHECK_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ status: 'down' });
  });
});
