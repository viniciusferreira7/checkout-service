import type { TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';
import { PaymentQueueService } from '@/events/payment-queue/payment-queue.service';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { checkoutServiceDetails } from '@/utils/checkout-service-details';
import { makeEventsModuleRef } from '../factories/make-events-module-ref';
import type { FakeRabbitmqService } from './fake-rabbitmq-service';

function makeOrder(
  overrides: Partial<PaymentOrderMessage> = {}
): PaymentOrderMessage {
  return {
    orderId: 'order-1',
    userId: 'user-1',
    amount: 180,
    discount: 20,
    items: [
      { productId: 'product-1', quantity: 2, price: 50 },
      { productId: 'product-2', quantity: 1, price: 100 },
    ],
    paymentMethod: 'credit_card',
    description: 'integration order',
    createdAt: new Date('2026-08-26T12:00:00.000Z'),
    ...overrides,
  };
}

describe('PaymentQueueService (integration)', () => {
  let moduleRef: TestingModule;
  let service: PaymentQueueService;
  let rabbitmq: FakeRabbitmqService;
  let env: EnvService;

  beforeEach(async () => {
    moduleRef = await makeEventsModuleRef();
    await moduleRef.init();

    service = moduleRef.get(PaymentQueueService);
    rabbitmq = moduleRef.get<unknown>(RabbitmqService) as FakeRabbitmqService;
    env = moduleRef.get(EnvService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('resolves the queue services through the container', () => {
    expect(service).toBeInstanceOf(PaymentQueueService);
    expect(rabbitmq.connected).toBe(true);
  });

  it('routes a valid order to the exchange configured in the environment', async () => {
    await service.publishPaymentOrderSafe(makeOrder());

    expect(rabbitmq.published).toHaveLength(1);
    expect(rabbitmq.published[0]).toMatchObject({
      exchange: env.get('RABBITMQ_EXCHANGE'),
      routingKey: env.get('RABBITMQ_ROUTING_KEY_PAYMENT_ORDER'),
    });
  });

  it('publishes the order enriched with the checkout service metadata', async () => {
    const order = makeOrder();

    await service.publishPaymentOrderSafe(order);

    expect(rabbitmq.published[0].message).toMatchObject({
      orderId: order.orderId,
      userId: order.userId,
      amount: order.amount,
      discount: order.discount,
      items: order.items,
      paymentMethod: order.paymentMethod,
      metadata: {
        version: checkoutServiceDetails.version,
        name: checkoutServiceDetails.name,
        timestamp: expect.any(String),
      },
    });
  });

  it('publishes a payload the payments service can deserialise', async () => {
    await service.publishPaymentOrderSafe(makeOrder());

    const payload = JSON.parse(
      Buffer.from(JSON.stringify(rabbitmq.published[0].message)).toString(
        'utf-8'
      )
    );

    expect(payload.orderId).toBe('order-1');
    expect(payload.createdAt).toBe('2026-08-26T12:00:00.000Z');
  });

  it('never reaches the broker when the order is invalid', async () => {
    await expect(
      service.publishPaymentOrderSafe(makeOrder({ amount: 999 }))
    ).rejects.toThrow('Invalid payment order');

    expect(rabbitmq.published).toHaveLength(0);
  });

  it('disconnects the broker when the container shuts down', async () => {
    await moduleRef.close();

    expect(rabbitmq.connected).toBe(false);
  });
});
