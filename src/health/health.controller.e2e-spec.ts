import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { DataSource } from 'typeorm';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';

describe('Health probes (E2E)', () => {
  describe('with a reachable database and broker', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startApp(await makeModuleRef());
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers GET /health like the readiness probe, without authentication', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
        checks: {
          database: { status: 'up', responseTime: expect.any(Number) },
          rabbitmq: { status: 'up', responseTime: expect.any(Number) },
        },
      });
    });

    it('answers the liveness probe without authentication', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
      });
    });

    it('answers the readiness probe with the database and broker up', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.statusCode).toBe(200);
      expect(response.body.checks.database.status).toBe('up');
      expect(response.body.checks.rabbitmq.status).toBe('up');
    });

    it('answers the startup probe with the database and broker up', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/startup')
        .expect(200);

      expect(response.body.checks.database.status).toBe('up');
      expect(response.body.checks.rabbitmq.status).toBe('up');
    });
  });

  describe('with an unreachable database', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await makeModuleRef((builder) =>
        builder.overrideProvider(DataSource).useFactory({
          factory() {
            return {
              query() {
                return Promise.reject(new Error('connection refused'));
              },

              isInitialized: false,

              // What `TypeOrmModule.forFeature` reads to build repositories;
              // nothing in this spec touches them.
              entityMetadatas: [],
              options: { type: 'postgres' },
              getRepository() {
                return {};
              },

              async destroy() {
                // no connection to close: this double is never connected
              },
            };
          },
        })
      );

      app = await startApp(moduleRef);
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers GET /health with 503 when the database is down', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.statusCode).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        uptime: expect.any(Number),
        checks: {
          database: { status: 'down', responseTime: expect.any(Number) },
          rabbitmq: { status: 'up', responseTime: expect.any(Number) },
        },
      });
    });

    it('keeps the liveness probe passing', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });

  describe('with an unreachable broker', () => {
    let app: INestApplication;
    let rabbitmqService: RabbitmqService;

    beforeAll(async () => {
      const moduleRef = await makeModuleRef();

      app = await startApp(moduleRef);
      rabbitmqService = moduleRef.get(RabbitmqService);
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await app.close();
    });

    it('fails the readiness probe when the channel is gone', async () => {
      vi.spyOn(rabbitmqService, 'getChannel').mockReturnValue(
        undefined as unknown as ReturnType<RabbitmqService['getChannel']>
      );

      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.statusCode).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        uptime: expect.any(Number),
        checks: {
          database: { status: 'up', responseTime: expect.any(Number) },
          rabbitmq: { status: 'down', responseTime: expect.any(Number) },
        },
      });
    });

    it('keeps the liveness probe passing', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });
});
