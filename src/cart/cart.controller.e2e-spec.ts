import { randomUUID } from 'node:crypto';
import {
  type INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { signTestToken } from 'test/factories/make-token';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { DataSource } from 'typeorm';
import { ProductsClientService } from '@/products-client/products-client.service';

const UNAUTHORIZED = { message: 'Unauthorized', statusCode: 401 };

describe('Cart routes (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const productsClient = { getProduct: vi.fn() };
  const product = {
    id: randomUUID(),
    name: 'Mechanical keyboard',
    price: 19.9,
    stock: 10,
    isActive: true,
    sellerId: randomUUID(),
  };

  const tokenFor = (id: string, role = 'buyer') =>
    signTestToken(
      { sub: id, email: 'ana@marketplace.dev', role },
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    const moduleRef = await makeModuleRef((builder) =>
      builder.overrideProvider(ProductsClientService).useValue(productsClient)
    );
    dataSource = moduleRef.get(DataSource);
    await dataSource.synchronize(true);
    app = await startApp(moduleRef);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE carts CASCADE');
    productsClient.getProduct.mockReset();
    productsClient.getProduct.mockResolvedValue(product);
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
    delete: (path: string) =>
      request(app.getHttpServer())
        .delete(path)
        .set('Authorization', `Bearer ${tokenFor(userId)}`),
  });

  it('answers an empty cart to a user who has none', async () => {
    const response = await as(randomUUID()).get('/cart').expect(200);

    expect(response.body).toEqual({
      id: null,
      status: 'active',
      total: 0,
      items: [],
    });
  });

  it('adds an item and answers 201 with the whole cart', async () => {
    const response = await as(randomUUID())
      .post('/cart/items', { productId: product.id, quantity: 3 })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'active',
      total: 59.7,
      items: [
        {
          productId: product.id,
          productName: 'Mechanical keyboard',
          price: 19.9,
          quantity: 3,
          subtotal: 59.7,
        },
      ],
    });
    expect(response.body).not.toHaveProperty('userId');
  });

  it('lets a seller use the cart too', async () => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenFor(randomUUID(), 'seller')}`)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);
  });

  it('shows the cart that was built', async () => {
    const userId = randomUUID();
    await as(userId).post('/cart/items', {
      productId: product.id,
      quantity: 2,
    });

    const response = await as(userId).get('/cart').expect(200);

    expect(response.body.total).toBe(39.8);
  });

  it('removes an item and answers the updated cart', async () => {
    const userId = randomUUID();
    const added = await as(userId).post('/cart/items', {
      productId: product.id,
      quantity: 2,
    });

    const response = await as(userId)
      .delete(`/cart/items/${added.body.items[0].id}`)
      .expect(200);

    expect(response.body).toMatchObject({ total: 0, items: [] });
  });

  it.each([
    ['a missing productId', { quantity: 1 }],
    ['a quantity of 0', { productId: randomUUID(), quantity: 0 }],
    ['a quantity of 100', { productId: randomUUID(), quantity: 100 }],
  ])('answers 400 to %s', async (_case, body) => {
    await as(randomUUID()).post('/cart/items', body).expect(400);
  });

  it('ignores a userId sent in the body', async () => {
    const owner = randomUUID();
    const response = await as(owner)
      .post('/cart/items', {
        productId: product.id,
        quantity: 1,
        userId: randomUUID(),
      })
      .expect(201);

    const mine = await as(owner).get('/cart').expect(200);
    expect(mine.body.id).toBe(response.body.id);
  });

  it('answers 400 to an item id that is not a uuid', async () => {
    await as(randomUUID()).delete('/cart/items/not-a-uuid').expect(400);
  });

  it('answers 404 when the product does not exist', async () => {
    productsClient.getProduct.mockResolvedValue(null);

    const response = await as(randomUUID())
      .post('/cart/items', { productId: randomUUID(), quantity: 1 })
      .expect(404);

    expect(response.body.message).toBe('Product not found');
  });

  it("answers 404 to removing another user's item", async () => {
    const added = await as(randomUUID()).post('/cart/items', {
      productId: product.id,
      quantity: 1,
    });

    await as(randomUUID())
      .delete(`/cart/items/${added.body.items[0].id}`)
      .expect(404);
  });

  it('answers 409 past the stock', async () => {
    await as(randomUUID())
      .post('/cart/items', { productId: product.id, quantity: 11 })
      .expect(409);
  });

  it('answers 503 when the products service is down', async () => {
    productsClient.getProduct.mockRejectedValue(
      new ServiceUnavailableException('Products service is unavailable')
    );

    await as(randomUUID())
      .post('/cart/items', { productId: product.id, quantity: 1 })
      .expect(503);
  });

  it.each([
    ['GET', '/cart'],
    ['POST', '/cart/items'],
    ['DELETE', `/cart/items/${randomUUID()}`],
  ])('answers 401 to %s %s without a token', async (method, path) => {
    const response = await request(app.getHttpServer())
      [method.toLowerCase() as 'get' | 'post' | 'delete'](path)
      .expect(401);

    expect(response.body).toEqual(UNAUTHORIZED);
  });
});
