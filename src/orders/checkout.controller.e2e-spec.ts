import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { FakeRabbitmqService } from 'test/events/fake-rabbitmq-service';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { signTestToken } from 'test/factories/make-token';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { DataSource } from 'typeorm';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { ProductsClientService } from '@/products-client/products-client.service';

const UNAUTHORIZED = { message: 'Unauthorized', statusCode: 401 };

describe('Checkout route (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let broker: FakeRabbitmqService;
  const productsClient = { getProduct: vi.fn() };
  const product = {
    id: randomUUID(),
    name: 'Mechanical keyboard',
    price: 19.9,
    stock: 10,
    isActive: true,
    sellerId: randomUUID(),
  };

  const tokenFor = (id: string) =>
    signTestToken(
      { sub: id, email: 'ana@marketplace.dev', role: 'buyer' },
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    const moduleRef = await makeModuleRef((builder) =>
      builder.overrideProvider(ProductsClientService).useValue(productsClient)
    );
    dataSource = moduleRef.get(DataSource);
    await dataSource.synchronize(true);
    broker = moduleRef.get(RabbitmqService) as unknown as FakeRabbitmqService;
    app = await startApp(moduleRef);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE carts, orders CASCADE');
    broker.published.length = 0;
    productsClient.getProduct.mockReset();
    productsClient.getProduct.mockResolvedValue(product);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (userId: string) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${tokenFor(userId)}`),
    post: (path: string, body: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${tokenFor(userId)}`)
        .send(body),
  });

  async function cartOf(userId: string, quantity = 3) {
    await as(userId)
      .post('/cart/items', { productId: product.id, quantity })
      .expect(201);
  }

  it('answers 201 with the pending order and publishes its payment', async () => {
    const userId = randomUUID();
    await cartOf(userId);

    const response = await as(userId)
      .post('/cart/checkout', { paymentMethod: 'pix' })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      cartId: expect.any(String),
      total: 59.7,
      status: 'pending',
      paymentMethod: 'pix',
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(broker.published).toHaveLength(1);
    expect(broker.published[0].message).toMatchObject({
      orderId: response.body.id,
      userId,
      amount: 59.7,
      discount: 0,
      items: [{ productId: product.id, quantity: 3, price: 19.9 }],
      paymentMethod: 'pix',
    });
  });

  it('leaves the user without an active cart, and a new add starts another', async () => {
    const userId = randomUUID();
    await cartOf(userId);
    const order = await as(userId).post('/cart/checkout', {
      paymentMethod: 'pix',
    });

    const emptied = await as(userId).get('/cart').expect(200);
    expect(emptied.body).toMatchObject({ id: null, items: [] });

    await cartOf(userId, 1);
    const next = await as(userId).get('/cart').expect(200);
    expect(next.body.id).not.toBe(order.body.cartId);
  });

  it('answers 400 to a second checkout of the same cart', async () => {
    const userId = randomUUID();
    await cartOf(userId);
    await as(userId)
      .post('/cart/checkout', { paymentMethod: 'pix' })
      .expect(201);

    const response = await as(userId)
      .post('/cart/checkout', { paymentMethod: 'pix' })
      .expect(400);

    expect(response.body.message).toBe('Cart is empty');
  });

  it('answers 400 to a user with no cart', async () => {
    const response = await as(randomUUID())
      .post('/cart/checkout', { paymentMethod: 'pix' })
      .expect(400);

    expect(response.body.message).toBe('Cart is empty');
  });

  it.each([
    ['a missing payment method', {}],
    ['an unknown payment method', { paymentMethod: 'crypto' }],
  ])('answers 400 to %s and keeps the cart', async (_case, body) => {
    const userId = randomUUID();
    await cartOf(userId);

    await as(userId).post('/cart/checkout', body).expect(400);

    const cart = await as(userId).get('/cart').expect(200);
    expect(cart.body.items).toHaveLength(1);
  });

  it('answers 201 even when the broker does not take the message', async () => {
    const userId = randomUUID();
    await cartOf(userId);
    vi.spyOn(broker, 'publicMessage').mockResolvedValue(false);

    const response = await as(userId)
      .post('/cart/checkout', { paymentMethod: 'boleto' })
      .expect(201);

    expect(response.body.status).toBe('pending');
  });

  it('answers 401 without a token', async () => {
    const response = await request(app.getHttpServer())
      .post('/cart/checkout')
      .send({ paymentMethod: 'pix' })
      .expect(401);

    expect(response.body).toEqual(UNAUTHORIZED);
  });
});
