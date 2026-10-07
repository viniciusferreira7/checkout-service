import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { makeModuleRef } from 'test/factories/make-module-ref';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { DataSource, type Repository } from 'typeorm';
import { metrics } from '@/observability/metrics';
import type { ProductSnapshot } from '@/products-client/product-snapshot';
import { ProductsClientService } from '@/products-client/products-client.service';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartStatus } from './enums/cart-status.enum';

function makeProduct(
  overrides: Partial<ProductSnapshot> = {}
): ProductSnapshot {
  return {
    id: randomUUID(),
    name: 'Mechanical keyboard',
    price: 19.9,
    stock: 10,
    isActive: true,
    sellerId: randomUUID(),
    ...overrides,
  };
}

describe('CartService (integration)', () => {
  let moduleRef: TestingModule;
  let service: CartService;
  let carts: Repository<Cart>;
  const productsClient = { getProduct: vi.fn() };
  const originals = { ...metrics };
  let operations: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    moduleRef = await makeModuleRef((builder) =>
      builder.overrideProvider(ProductsClientService).useValue(productsClient)
    );
    await moduleRef.get(DataSource).synchronize(true);

    service = moduleRef.get(CartService);
    carts = moduleRef.get(getRepositoryToken(Cart));
  });

  beforeEach(async () => {
    await moduleRef.get(DataSource).query('TRUNCATE carts CASCADE');
    productsClient.getProduct.mockReset();
    operations = vi.fn();
    Object.assign(metrics, {
      cart_operations: { add: operations },
      cart_operation_duration: { record: vi.fn() },
    });
  });

  afterEach(() => {
    Object.assign(metrics, originals);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const given = <T extends ProductSnapshot | null>(product: T): T => {
    productsClient.getProduct.mockResolvedValue(product);

    return product;
  };

  describe('findActive', () => {
    it('answers null for a user with no active cart', async () => {
      await expect(service.findActive(randomUUID())).resolves.toBeNull();
    });
  });

  describe('addItem', () => {
    it('creates the cart and snapshots name and price', async () => {
      const userId = randomUUID();
      const product = given(makeProduct());

      const cart = await service.addItem(userId, {
        productId: product.id,
        quantity: 3,
      });

      expect(cart).toMatchObject({
        userId,
        status: CartStatus.ACTIVE,
        total: 59.7,
      });
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]).toMatchObject({
        productId: product.id,
        productName: 'Mechanical keyboard',
        price: 19.9,
        quantity: 3,
        subtotal: 59.7,
      });
      expect(operations).toHaveBeenCalledExactlyOnceWith(1, {
        operation: 'add_item',
        outcome: 'succeeded',
      });
    });

    it('adds to the quantity of a product already in the cart, keeping its first price', async () => {
      const userId = randomUUID();
      const product = given(makeProduct());
      await service.addItem(userId, { productId: product.id, quantity: 1 });
      given({ ...product, price: 25 });

      const cart = await service.addItem(userId, {
        productId: product.id,
        quantity: 2,
      });

      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]).toMatchObject({
        quantity: 3,
        price: 19.9,
        subtotal: 59.7,
      });
      expect(cart.total).toBe(59.7);
    });

    it('totals every item of the cart', async () => {
      const userId = randomUUID();
      const keyboard = given(makeProduct());
      await service.addItem(userId, { productId: keyboard.id, quantity: 3 });
      const mouse = given(makeProduct({ name: 'Mouse', price: 0.1 }));

      const cart = await service.addItem(userId, {
        productId: mouse.id,
        quantity: 2,
      });

      expect(cart.total).toBe(59.9);
    });

    it.each([
      ['a product the products service does not know', null],
      ['an inactive product', makeProduct({ isActive: false })],
    ])('answers 404 for %s and creates no cart', async (_case, product) => {
      const userId = randomUUID();
      given(product);

      await expect(
        service.addItem(userId, { productId: randomUUID(), quantity: 1 })
      ).rejects.toThrow(new NotFoundException('Product not found'));
      await expect(service.findActive(userId)).resolves.toBeNull();
      expect(operations).toHaveBeenCalledExactlyOnceWith(1, {
        operation: 'add_item',
        outcome: 'product_not_found',
      });
    });

    it('answers 409 when the cart would hold more than the stock, and changes nothing', async () => {
      const userId = randomUUID();
      const product = given(makeProduct({ stock: 3 }));
      await service.addItem(userId, { productId: product.id, quantity: 2 });

      await expect(
        service.addItem(userId, { productId: product.id, quantity: 2 })
      ).rejects.toThrow(new ConflictException('Not enough stock'));

      const cart = await service.findActive(userId);
      expect(cart?.items[0].quantity).toBe(2);
      expect(operations).toHaveBeenCalledWith(1, {
        operation: 'add_item',
        outcome: 'out_of_stock',
      });
    });

    it('answers 409 instead of overflowing decimal(10,2)', async () => {
      const userId = randomUUID();
      const product = given(makeProduct({ price: 99999999.99, stock: 99 }));

      await expect(
        service.addItem(userId, { productId: product.id, quantity: 2 })
      ).rejects.toThrow(
        new ConflictException('Cart total exceeds the maximum')
      );
    });

    it('lets the products-service outage through as is', async () => {
      const outage = new Error('Products service is unavailable');
      productsClient.getProduct.mockRejectedValue(outage);

      await expect(
        service.addItem(randomUUID(), { productId: randomUUID(), quantity: 1 })
      ).rejects.toBe(outage);
    });

    it('keeps one active cart when two first adds race', async () => {
      const userId = randomUUID();
      const product = given(makeProduct());

      await Promise.all([
        service.addItem(userId, { productId: product.id, quantity: 1 }),
        service.addItem(userId, { productId: product.id, quantity: 1 }),
      ]);

      const active = await carts.findBy({ userId, status: CartStatus.ACTIVE });
      expect(active).toHaveLength(1);
      expect(active[0].items[0].quantity).toBe(2);
      expect(active[0].total).toBe(39.8);
    });

    it('starts a new cart once the previous one was completed', async () => {
      const userId = randomUUID();
      const product = given(makeProduct());
      const first = await service.addItem(userId, {
        productId: product.id,
        quantity: 1,
      });
      await carts.update(first.id, { status: CartStatus.COMPLETED });

      const second = await service.addItem(userId, {
        productId: product.id,
        quantity: 1,
      });

      expect(second.id).not.toBe(first.id);
    });
  });

  describe('removeItem', () => {
    async function cartWithTwoItems(userId: string) {
      const keyboard = given(makeProduct());
      await service.addItem(userId, { productId: keyboard.id, quantity: 3 });
      const mouse = given(makeProduct({ name: 'Mouse', price: 10 }));

      return service.addItem(userId, { productId: mouse.id, quantity: 1 });
    }

    it('removes the item and recomputes the total', async () => {
      const userId = randomUUID();
      const cart = await cartWithTwoItems(userId);
      const [mouse] = cart.items.filter((item) => item.productName === 'Mouse');

      const updated = await service.removeItem(userId, mouse.id);

      expect(updated.items.map((item) => item.productName)).toEqual([
        'Mechanical keyboard',
      ]);
      expect(updated.total).toBe(59.7);
      expect(operations).toHaveBeenCalledWith(1, {
        operation: 'remove_item',
        outcome: 'succeeded',
      });
    });

    it('leaves an empty active cart with a zero total', async () => {
      const userId = randomUUID();
      const product = given(makeProduct());
      const cart = await service.addItem(userId, {
        productId: product.id,
        quantity: 1,
      });

      const updated = await service.removeItem(userId, cart.items[0].id);

      expect(updated).toMatchObject({ status: CartStatus.ACTIVE, total: 0 });
      expect(updated.items).toEqual([]);
    });

    it.each([
      ['an item that does not exist', async () => randomUUID()],
      [
        "another user's item",
        async () => (await cartWithTwoItems(randomUUID())).items[0].id,
      ],
    ])('answers 404 for %s and changes nothing', async (_case, itemIdOf) => {
      const userId = randomUUID();
      await cartWithTwoItems(userId);
      const itemId = await itemIdOf();

      await expect(service.removeItem(userId, itemId)).rejects.toThrow(
        new NotFoundException('Cart item not found')
      );
      expect((await service.findActive(userId))?.items).toHaveLength(2);
    });

    it('answers 404 for an item of a completed cart', async () => {
      const userId = randomUUID();
      const cart = await cartWithTwoItems(userId);
      await carts.update(cart.id, { status: CartStatus.COMPLETED });

      await expect(
        service.removeItem(userId, cart.items[0].id)
      ).rejects.toThrow(new NotFoundException('Cart item not found'));
    });
  });

  describe('racing a checkout', () => {
    type Settled<T> =
      | { status: 'fulfilled'; value: T }
      | { status: 'rejected'; reason: unknown };

    /** Resolves once some query of this database waits on a row lock. */
    async function untilALockIsAwaited(): Promise<void> {
      const dataSource = moduleRef.get(DataSource);

      for (let attempt = 0; attempt < 200; attempt++) {
        const [{ waiting }] = await dataSource.query(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`
        );

        if (waiting > 0) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      throw new Error('No query ever waited on the cart lock');
    }

    /**
     * Holds the user's active cart as a checkout does, starts `action`, and
     * once it waits on that lock completes the cart and commits: the exact
     * interleaving a checkout in another tab produces.
     */
    async function whileACheckoutCompletes<T>(
      userId: string,
      action: () => Promise<T>
    ): Promise<{ completedCartId: string; outcome: Settled<T> }> {
      const runner = moduleRef.get(DataSource).createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        const [cart] = await runner.query(
          `SELECT id FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE`,
          [userId]
        );
        const outcome = action().then(
          (value): Settled<T> => ({ status: 'fulfilled', value }),
          (reason): Settled<T> => ({ status: 'rejected', reason })
        );

        await untilALockIsAwaited();
        await runner.query(
          `UPDATE carts SET status = 'completed' WHERE id = $1`,
          [cart.id]
        );
        await runner.commitTransaction();

        return { completedCartId: cart.id, outcome: await outcome };
      } finally {
        await runner.release();
      }
    }

    it('leaves a cart that a checkout completed while the removal waited untouched', async () => {
      const userId = randomUUID();
      const keyboard = given(makeProduct());
      await service.addItem(userId, { productId: keyboard.id, quantity: 3 });
      const mouse = given(makeProduct({ name: 'Mouse', price: 10 }));
      const cart = await service.addItem(userId, {
        productId: mouse.id,
        quantity: 1,
      });

      const { outcome } = await whileACheckoutCompletes(userId, () =>
        service.removeItem(userId, cart.items[0].id)
      );

      expect(outcome).toEqual({
        status: 'rejected',
        reason: new NotFoundException('Cart item not found'),
      });
      const completed = await carts.findOneByOrFail({ id: cart.id });
      expect(completed.items).toHaveLength(2);
      expect(completed.total).toBe(69.7);
    });

    it('adds to a new cart when a checkout completed the old one while the add waited', async () => {
      const userId = randomUUID();
      const product = given(makeProduct());
      await service.addItem(userId, { productId: product.id, quantity: 1 });

      const { completedCartId, outcome } = await whileACheckoutCompletes(
        userId,
        () => service.addItem(userId, { productId: product.id, quantity: 2 })
      );

      expect(outcome.status).toBe('fulfilled');
      const next = (outcome as { value: Cart }).value;
      expect(next.id).not.toBe(completedCartId);
      expect(next.items).toHaveLength(1);
      expect(next.items[0].quantity).toBe(2);
      const completed = await carts.findOneByOrFail({ id: completedCartId });
      expect(completed.items[0].quantity).toBe(1);
    });
  });
});
