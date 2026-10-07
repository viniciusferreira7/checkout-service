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
});
