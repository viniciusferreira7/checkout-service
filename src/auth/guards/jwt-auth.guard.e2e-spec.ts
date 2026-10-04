import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { startApp } from 'test/factories/make-module-ref';
import {
  signTestToken,
  tamperPayload,
  unsignedToken,
} from 'test/factories/make-token';
import { TestRoutesModule } from 'test/factories/test-routes.module';
import { AppModule } from '@/app.module';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { FakeRabbitmqService } from '../../../test/events/fake-rabbitmq-service';

const UNAUTHORIZED = { message: 'Unauthorized', statusCode: 401 };
const OTHER_SECRET = 'another-secret-that-is-at-least-32-chars';

describe('Global JWT guard (E2E)', () => {
  let app: INestApplication;

  const user = {
    id: randomUUID(),
    email: 'ana@marketplace.dev',
    role: 'seller',
  };
  const claims = () => ({ sub: user.id, email: user.email, role: user.role });
  const now = () => Math.floor(Date.now() / 1000);
  const validToken = () => signTestToken(claims(), { expiresIn: '24h' });

  const whoAmI = (authorization?: string) => {
    const call = request(app.getHttpServer()).get('/test/protected');

    return authorization ? call.set('Authorization', authorization) : call;
  };

  beforeAll(async () => {
    // The checkout dials RabbitMQ on boot; the fake keeps the broker out.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TestRoutesModule],
    })
      .overrideProvider(RabbitmqService)
      .useClass(FakeRabbitmqService)
      .compile();

    app = await startApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a protected route to a valid token, with exactly { id, email, role } as req.user', async () => {
    const response = await whoAmI(`Bearer ${validToken()}`).expect(200);

    expect(response.body).toEqual(user);
  });

  it('accepts a lowercase bearer scheme', async () => {
    await whoAmI(`bearer ${validToken()}`).expect(200);
  });

  it('keeps extra claims out of req.user', async () => {
    const token = signTestToken(
      { ...claims(), name: 'Ana', isAdmin: true },
      { expiresIn: '24h' }
    );

    const response = await whoAmI(`Bearer ${token}`).expect(200);

    expect(response.body).toEqual(user);
  });

  it.each<[string, () => string | undefined]>([
    ['no Authorization header', () => undefined],
    ['a Token scheme', () => `Token ${validToken()}`],
    ['Bearer without a token', () => 'Bearer '],
    [
      'a token signed with another secret',
      () => `Bearer ${signTestToken(claims(), { secret: OTHER_SECRET })}`,
    ],
    [
      'a tampered payload',
      () => `Bearer ${tamperPayload(validToken(), { role: 'buyer' })}`,
    ],
    [
      'an expired token',
      () =>
        `Bearer ${signTestToken({ ...claims(), iat: now() - 7200, exp: now() - 60 })}`,
    ],
    [
      'a token not valid yet (nbf in the future)',
      () => `Bearer ${signTestToken({ ...claims(), nbf: now() + 3600 })}`,
    ],
    ['an alg none token', () => `Bearer ${unsignedToken(claims())}`],
    [
      'an HS512 token with the right secret',
      () => `Bearer ${signTestToken(claims(), { algorithm: 'HS512' })}`,
    ],
    [
      'a role outside seller and buyer',
      () => `Bearer ${signTestToken({ ...claims(), role: 'admin' })}`,
    ],
    [
      'no sub',
      () => `Bearer ${signTestToken({ email: user.email, role: user.role })}`,
    ],
    [
      'a sub that is not a uuid',
      () => `Bearer ${signTestToken({ ...claims(), sub: 'user-1' })}`,
    ],
    [
      'an invalid email',
      () => `Bearer ${signTestToken({ ...claims(), email: 'nope' })}`,
    ],
  ])('answers the same 401 to %s', async (_case, authorization) => {
    const response = await whoAmI(authorization()).expect(401);

    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it.each(['/', '/health'])(
    'keeps GET %s open without a token',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(200);
    }
  );

  it('ignores a bad token on a public route', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer not-a-token')
      .expect(200);
  });

  it('opens every route of a controller marked @Public()', async () => {
    await request(app.getHttpServer()).get('/test/public').expect(200);
  });

  it.each(['/auth/login', '/auth/register'])(
    'exposes no %s route',
    async (path) => {
      await request(app.getHttpServer()).post(path).send({}).expect(404);
    }
  );
});
