import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { makeModuleRef } from 'test/factories/make-module-ref';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { sqlStateOf } from 'test/utils/sql-state-of';
import { DataSource, type Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartStatus } from './enums/cart-status.enum';

function makeItem(overrides: Partial<CartItem> = {}): Partial<CartItem> {
  return {
    productId: randomUUID(),
    productName: 'Mechanical keyboard',
    price: 19.9,
    quantity: 3,
    subtotal: 59.7,
    ...overrides,
  };
}

describe('Cart persistence (integration)', () => {
  let moduleRef: TestingModule;
  let carts: Repository<Cart>;
  let items: Repository<CartItem>;

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    moduleRef = await makeModuleRef();
    // `synchronize` is off outside dev: build the schema from the entities.
    await moduleRef.get(DataSource).synchronize(true);

    carts = moduleRef.get(getRepositoryToken(Cart));
    items = moduleRef.get(getRepositoryToken(CartItem));
  });

  beforeEach(async () => {
    await moduleRef.get(DataSource).query('TRUNCATE carts CASCADE');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('creates an active cart with a zero total', async () => {
    const { id } = await carts.save(carts.create({ userId: randomUUID() }));
    const found = await carts.findOneByOrFail({ id });

    expect(found.status).toBe(CartStatus.ACTIVE);
    expect(found.total).toBe(0);
    expect(found.items).toEqual([]);
  });

  it('saves items through the cart and reads money back as numbers', async () => {
    const { id } = await carts.save(
      carts.create({ userId: randomUUID(), total: 59.7, items: [makeItem()] })
    );
    const found = await carts.findOneByOrFail({ id });

    expect(found.total).toBe(59.7);
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({
      price: 19.9,
      subtotal: 59.7,
      quantity: 3,
    });
  });

  it('refuses a second active cart for the same user', async () => {
    const userId = randomUUID();
    await carts.save(carts.create({ userId }));

    // 23505 = unique_violation
    await expect(sqlStateOf(carts.insert({ userId }))).resolves.toBe('23505');
  });

  it('lets a completed cart and an active cart of the same user coexist', async () => {
    const userId = randomUUID();
    await carts.save(carts.create({ userId, status: CartStatus.COMPLETED }));

    await expect(carts.save(carts.create({ userId }))).resolves.toBeDefined();
  });

  it('refuses the same product twice in one cart', async () => {
    const productId = randomUUID();
    const { id: cartId } = await carts.save(
      carts.create({ userId: randomUUID() })
    );
    await items.insert({ ...makeItem({ productId }), cartId });

    await expect(
      sqlStateOf(items.insert({ ...makeItem({ productId }), cartId }))
    ).resolves.toBe('23505');
  });

  it('deletes the items with their cart', async () => {
    const { id } = await carts.save(
      carts.create({ userId: randomUUID(), items: [makeItem()] })
    );

    await carts.delete(id);

    await expect(items.count()).resolves.toBe(0);
  });

  it.each([
    ['a negative price', { price: -1 }],
    ['a NaN price', { price: Number.NaN }],
    ['a zero quantity', { quantity: 0 }],
    ['a negative subtotal', { subtotal: -1 }],
  ])('rejects an item with %s', async (_case, overrides) => {
    const { id: cartId } = await carts.save(
      carts.create({ userId: randomUUID() })
    );

    // 23514 = check_violation
    await expect(
      sqlStateOf(items.insert({ ...makeItem(overrides), cartId }))
    ).resolves.toBe('23514');
  });

  it('rejects a negative cart total', async () => {
    await expect(
      sqlStateOf(carts.insert({ userId: randomUUID(), total: -1 }))
    ).resolves.toBe('23514');
  });
});
