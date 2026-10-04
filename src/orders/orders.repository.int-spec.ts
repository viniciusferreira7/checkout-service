import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { makeModuleRef } from 'test/factories/make-module-ref';
import { assertTestDatabase } from 'test/utils/assert-test-database';
import { sqlStateOf } from 'test/utils/sql-state-of';
import { DataSource, type Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';

describe('Order persistence (integration)', () => {
  let moduleRef: TestingModule;
  let orders: Repository<Order>;

  const makeOrder = (overrides: Partial<Order> = {}): Partial<Order> => ({
    userId: randomUUID(),
    cartId: randomUUID(),
    total: 59.7,
    paymentMethod: 'pix',
    ...overrides,
  });

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL);

    moduleRef = await makeModuleRef();
    await moduleRef.get(DataSource).synchronize(true);
    orders = moduleRef.get(getRepositoryToken(Order));
  });

  beforeEach(async () => {
    await orders.clear();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('creates a pending order and reads the total back as a number', async () => {
    const { id } = await orders.save(orders.create(makeOrder()));
    const found = await orders.findOneByOrFail({ id });

    expect(found.status).toBe(OrderStatus.PENDING);
    expect(found.total).toBe(59.7);
    expect(found.createdAt).toBeInstanceOf(Date);
  });

  it.each([
    ['a negative total', { total: -1 }],
    ['a NaN total', { total: Number.NaN }],
  ])('rejects %s', async (_case, overrides) => {
    await expect(sqlStateOf(orders.insert(makeOrder(overrides)))).resolves.toBe(
      '23514'
    );
  });

  it('rejects a payment method longer than 50 characters', async () => {
    // 22001 = string_data_right_truncation
    await expect(
      sqlStateOf(orders.insert(makeOrder({ paymentMethod: 'x'.repeat(51) })))
    ).resolves.toBe('22001');
  });
});
