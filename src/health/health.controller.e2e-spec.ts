import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startApp(await makeModuleRef());
  });

  afterAll(async () => {
    await app.close();
  });

  it('identifies the service without a token', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      service: 'checkout-service',
    });
  });
});
