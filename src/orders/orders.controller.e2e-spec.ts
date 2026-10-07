import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { signTestToken } from 'test/factories/make-token';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { DataSource, type Repository } from 'typeorm';
import { Order } from './entities/order.entity';

const UNAUTHORIZED = { message: 'Unauthorized', statusCode: 401 };

describe('Orders routes (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: Repository<Order>;

  const tokenFor = (id: string) =>
    signTestToken(
      { sub: id, email: 'ana@marketplace.dev', role: 'buyer' },
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    const moduleRef = await makeModuleRef();
    dataSource = moduleRef.get(DataSource);
    await dataSource.synchronize(true);
    orders = moduleRef.get(getRepositoryToken(Order));
    app = await startApp(moduleRef);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE carts, orders CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (userId: string, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${tokenFor(userId)}`);

  const placeOrder = (userId: string, createdAt: Date) =>
    orders.save(
      orders.create({
        userId,
        cartId: randomUUID(),
        total: 59.7,
        paymentMethod: 'pix',
        createdAt,
      })
    );

  describe('GET /orders', () => {
    it("lists the user's orders, newest first, without the owner id", async () => {
      const userId = randomUUID();
      const older = await placeOrder(userId, new Date('2026-10-01T12:00:00Z'));
      const newer = await placeOrder(userId, new Date('2026-10-02T12:00:00Z'));
      await placeOrder(randomUUID(), new Date('2026-10-03T12:00:00Z'));

      const response = await get(userId, '/orders').expect(200);

      expect(response.body.map((order: { id: string }) => order.id)).toEqual([
        newer.id,
        older.id,
      ]);
      expect(response.body[0]).toMatchObject({
        total: 59.7,
        status: 'pending',
        paymentMethod: 'pix',
      });
      expect(response.body[0]).not.toHaveProperty('userId');
    });

    it('answers [] to a user without orders', async () => {
      const response = await get(randomUUID(), '/orders').expect(200);

      expect(response.body).toEqual([]);
    });

    it('answers 401 without a token', async () => {
      const response = await request(app.getHttpServer())
        .get('/orders')
        .expect(401);

      expect(response.body).toEqual(UNAUTHORIZED);
    });
  });

  describe('GET /orders/:id', () => {
    it("answers the user's order", async () => {
      const userId = randomUUID();
      const order = await placeOrder(userId, new Date());

      const response = await get(userId, `/orders/${order.id}`).expect(200);

      expect(response.body).toMatchObject({ id: order.id, total: 59.7 });
      expect(response.body).not.toHaveProperty('userId');
    });

    it("answers 404, not 403, to another user's order", async () => {
      const order = await placeOrder(randomUUID(), new Date());

      const response = await get(randomUUID(), `/orders/${order.id}`).expect(
        404
      );

      expect(response.body.message).toBe('Order not found');
    });

    it('answers 404 to an order that does not exist', async () => {
      await get(randomUUID(), `/orders/${randomUUID()}`).expect(404);
    });

    it('answers 400 to an id that is not a uuid', async () => {
      await get(randomUUID(), '/orders/not-a-uuid').expect(400);
    });

    it('answers 401 without a token', async () => {
      const response = await request(app.getHttpServer())
        .get(`/orders/${randomUUID()}`)
        .expect(401);

      expect(response.body).toEqual(UNAUTHORIZED);
    });
  });
});
