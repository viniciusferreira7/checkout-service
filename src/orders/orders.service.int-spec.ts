import { randomUUID } from 'node:crypto';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { FakeRabbitmqService } from 'test/events/fake-rabbitmq-service';
import { makeModuleRef } from 'test/factories/make-module-ref';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { DataSource, type Repository } from 'typeorm';
import { Cart } from '@/cart/entities/cart.entity';
import { CartStatus } from '@/cart/enums/cart-status.enum';
import { fromCents, toCents } from '@/common/money';
import type { PaymentMethod } from '@/common/payment-methods';
import { PaymentQueueService } from '@/events/payment-queue/payment-queue.service';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import { OrdersService } from './orders.service';

type SeedItem = { productId?: string; price: number; quantity: number };

describe('OrdersService (integration)', () => {
  let moduleRef: TestingModule;
  let service: OrdersService;
  let carts: Repository<Cart>;
  let orders: Repository<Order>;
  let broker: FakeRabbitmqService;

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    moduleRef = await makeModuleRef();
    await moduleRef.get(DataSource).synchronize(true);

    service = moduleRef.get(OrdersService);
    carts = moduleRef.get(getRepositoryToken(Cart));
    orders = moduleRef.get(getRepositoryToken(Order));
    broker = moduleRef.get(RabbitmqService) as unknown as FakeRabbitmqService;
  });

  beforeEach(async () => {
    await moduleRef.get(DataSource).query('TRUNCATE carts, orders CASCADE');
    broker.published.length = 0;
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** An active cart whose subtotals and total add up in cents, as CartService keeps them. */
  async function seedCart(userId: string, items: SeedItem[]): Promise<Cart> {
    const lines = items.map((item, index) => ({
      productId: item.productId ?? randomUUID(),
      productName: `Product ${index + 1}`,
      price: item.price,
      quantity: item.quantity,
      subtotal: fromCents(toCents(item.price) * item.quantity),
    }));
    const totalCents = lines.reduce(
      (sum, line) => sum + toCents(line.subtotal),
      0
    );

    return carts.save(
      carts.create({ userId, total: fromCents(totalCents), items: lines })
    );
  }

  describe('checkout', () => {
    it('places a pending order for the cart total and completes the cart', async () => {
      const userId = randomUUID();
      const cart = await seedCart(userId, [{ price: 19.9, quantity: 3 }]);

      const order = await service.checkout(userId, 'pix');

      expect(order).toMatchObject({
        userId,
        cartId: cart.id,
        total: 59.7,
        status: OrderStatus.PENDING,
        paymentMethod: 'pix',
      });
      await expect(
        orders.findOneByOrFail({ id: order.id })
      ).resolves.toMatchObject({
        total: 59.7,
      });
      await expect(
        carts.findOneByOrFail({ id: cart.id })
      ).resolves.toMatchObject({
        status: CartStatus.COMPLETED,
      });
    });

    it('publishes the payment order with the cart snapshot', async () => {
      const userId = randomUUID();
      const productId = randomUUID();
      await seedCart(userId, [
        { productId, price: 19.9, quantity: 3 },
        { price: 0.1, quantity: 2 },
      ]);

      const order = await service.checkout(userId, 'credit_card');

      expect(broker.published).toHaveLength(1);
      expect(broker.published[0]).toMatchObject({
        exchange: 'payments',
        routingKey: 'payment.order',
        message: {
          orderId: order.id,
          userId,
          amount: 59.9,
          discount: 0,
          paymentMethod: 'credit_card',
          createdAt: order.createdAt,
        },
      });
      expect(
        (broker.published[0].message as { items: unknown[] }).items
      ).toEqual(
        expect.arrayContaining([
          { productId, quantity: 3, price: 19.9 },
          { productId: expect.any(String), quantity: 2, price: 0.1 },
        ])
      );
    });

    it('answers 400 when the user has no active cart', async () => {
      await expect(service.checkout(randomUUID(), 'pix')).rejects.toThrow(
        new BadRequestException('Cart is empty')
      );
      expect(await orders.count()).toBe(0);
    });

    it('answers 400 to an active cart left without items, and keeps it active', async () => {
      const userId = randomUUID();
      const cart = await seedCart(userId, []);

      await expect(service.checkout(userId, 'pix')).rejects.toThrow(
        new BadRequestException('Cart is empty')
      );
      expect(await orders.count()).toBe(0);
      await expect(
        carts.findOneByOrFail({ id: cart.id })
      ).resolves.toMatchObject({
        status: CartStatus.ACTIVE,
      });
    });

    it('places one order when two checkouts of the same cart race', async () => {
      const userId = randomUUID();
      await seedCart(userId, [{ price: 10, quantity: 1 }]);

      const results = await Promise.allSettled([
        service.checkout(userId, 'pix'),
        service.checkout(userId, 'pix'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [refused] = results.filter((r) => r.status === 'rejected');
      expect((refused as PromiseRejectedResult).reason).toEqual(
        new BadRequestException('Cart is empty')
      );
      expect(await orders.countBy({ userId })).toBe(1);
      expect(broker.published).toHaveLength(1);
    });

    // The cart is completed before the order is inserted, so a failed insert
    // proves the completion was rolled back too.
    it('writes nothing when creating the order fails', async () => {
      const userId = randomUUID();
      const cart = await seedCart(userId, [{ price: 10, quantity: 1 }]);
      // Past varchar(50): the insert fails inside the transaction.
      const tooLong = 'x'.repeat(51) as PaymentMethod;

      await expect(service.checkout(userId, tooLong)).rejects.toThrow();

      expect(await orders.count()).toBe(0);
      await expect(
        carts.findOneByOrFail({ id: cart.id })
      ).resolves.toMatchObject({
        status: CartStatus.ACTIVE,
      });
      expect(broker.published).toHaveLength(0);
    });

    it('keeps the order when the broker does not take the message', async () => {
      const userId = randomUUID();
      const cart = await seedCart(userId, [{ price: 10, quantity: 1 }]);
      vi.spyOn(broker, 'publicMessage').mockResolvedValue(false);

      const order = await service.checkout(userId, 'pix');

      expect(order.status).toBe(OrderStatus.PENDING);
      await expect(
        orders.findOneByOrFail({ id: order.id })
      ).resolves.toBeDefined();
      await expect(
        carts.findOneByOrFail({ id: cart.id })
      ).resolves.toMatchObject({
        status: CartStatus.COMPLETED,
      });
    });

    it('keeps the order when publishing throws, and logs it', async () => {
      const userId = randomUUID();
      await seedCart(userId, [{ price: 10, quantity: 1 }]);
      vi.spyOn(
        moduleRef.get(PaymentQueueService),
        'publishPaymentOrderSafe'
      ).mockRejectedValue(new Error('Invalid payment order'));

      const order = await service.checkout(userId, 'pix');

      await expect(
        orders.findOneByOrFail({ id: order.id })
      ).resolves.toBeDefined();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        `Payment order for order ${order.id} was not published`,
        expect.any(String)
      );
    });
  });

  describe('findAllByUser', () => {
    const at = (iso: string) => new Date(iso);

    it("answers only the user's orders, newest first", async () => {
      const userId = randomUUID();
      const make = (createdAt: Date, owner = userId) =>
        orders.create({
          userId: owner,
          cartId: randomUUID(),
          total: 10,
          paymentMethod: 'pix',
          createdAt,
        });
      const [oldest, newest] = await orders.save([
        make(at('2026-10-01T12:00:00Z')),
        make(at('2026-10-03T12:00:00Z')),
        make(at('2026-10-02T12:00:00Z'), randomUUID()),
      ]);

      const found = await service.findAllByUser(userId);

      expect(found.map((order) => order.id)).toEqual([newest.id, oldest.id]);
    });

    it('answers an empty list to a user without orders', async () => {
      await expect(service.findAllByUser(randomUUID())).resolves.toEqual([]);
    });
  });

  describe('findOneByUser', () => {
    const place = (userId: string) =>
      orders.save(
        orders.create({
          userId,
          cartId: randomUUID(),
          total: 10,
          paymentMethod: 'pix',
        })
      );

    it("answers the user's order", async () => {
      const userId = randomUUID();
      const order = await place(userId);

      await expect(
        service.findOneByUser(userId, order.id)
      ).resolves.toMatchObject({
        id: order.id,
        total: 10,
      });
    });

    it.each([
      ['an order that does not exist', async () => randomUUID()],
      ["another user's order", async () => (await place(randomUUID())).id],
    ])('answers 404 for %s', async (_case, orderIdOf) => {
      const orderId = await orderIdOf();

      await expect(
        service.findOneByUser(randomUUID(), orderId)
      ).rejects.toThrow(new NotFoundException('Order not found'));
    });
  });
});
