import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from './factories/make-module-ref';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await makeModuleRef();
    app = await startApp(moduleRef);
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('answers a HEAD request on the health route', () => {
    return request(app.getHttpServer()).head('/').expect(200);
  });

  it('returns 404 for an unknown route', () => {
    return request(app.getHttpServer()).get('/unknown').expect(404);
  });

  it('exposes the CORS headers configured in main.ts', () => {
    return request(app.getHttpServer())
      .get('/')
      .set('Origin', 'http://localhost:3000')
      .expect(200)
      .expect('access-control-allow-origin', '*');
  });
});
