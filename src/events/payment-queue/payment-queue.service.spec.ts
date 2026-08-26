import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { checkoutServiceDetails } from '@/utils/checkout-service-details';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { PaymentQueueService } from './payment-queue.service';

const silence = () => undefined;

const env: Record<string, string> = {
  RABBITMQ_QUEUE_PAYMENTS: 'payment_queue',
  RABBITMQ_EXCHANGE: 'payments',
  RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: 'payment.order',
};

function makeOrder(
  overrides: Partial<PaymentOrderMessage> = {}
): PaymentOrderMessage {
  return {
    orderId: 'order-1',
    userId: 'user-1',
    amount: 100,
    discount: 0,
    items: [{ productId: 'product-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
    createdAt: new Date('2026-08-26T12:00:00.000Z'),
    ...overrides,
  };
}

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;
  let rabbitMqService: { publicMessage: ReturnType<typeof vi.fn> };
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);

    rabbitMqService = {
      publicMessage: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentQueueService,
        { provide: RabbitmqService, useValue: rabbitMqService },
        { provide: EnvService, useValue: { get: vi.fn((key) => env[key]) } },
      ],
    }).compile();

    service = module.get<PaymentQueueService>(PaymentQueueService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publishPaymentOrderSafe', () => {
    it('publishes to the configured exchange and routing key', async () => {
      const order = makeOrder();

      await service.publishPaymentOrderSafe(order);

      expect(rabbitMqService.publicMessage).toHaveBeenCalledTimes(1);
      expect(rabbitMqService.publicMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          exchange: env.RABBITMQ_EXCHANGE,
          routingKey: env.RABBITMQ_ROUTING_KEY_PAYMENT_ORDER,
        })
      );
    });

    it('enriches the order with the service metadata', async () => {
      const order = makeOrder();

      await service.publishPaymentOrderSafe(order);

      const { message } = rabbitMqService.publicMessage.mock.calls[0][0];

      expect(message).toMatchObject({
        ...order,
        metadata: {
          version: checkoutServiceDetails.version,
          name: checkoutServiceDetails.name,
          timestamp: expect.any(String),
        },
      });
    });

    it('stamps a timestamp the consumer can parse', async () => {
      await service.publishPaymentOrderSafe(makeOrder());

      const { message } = rabbitMqService.publicMessage.mock.calls[0][0];

      expect(Number.isNaN(Date.parse(message.metadata.timestamp))).toBe(false);
    });

    it('keeps the order createdAt when it is present', async () => {
      const createdAt = new Date('2020-01-01T00:00:00.000Z');

      await service.publishPaymentOrderSafe(makeOrder({ createdAt }));

      const { message } = rabbitMqService.publicMessage.mock.calls[0][0];

      expect(message.createdAt).toBe(createdAt);
    });

    it('falls back to the current date when createdAt is missing', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-08-26T12:00:00.000Z');
      vi.setSystemTime(now);

      await service.publishPaymentOrderSafe(
        makeOrder({ createdAt: undefined as unknown as Date })
      );

      const { message } = rabbitMqService.publicMessage.mock.calls[0][0];

      expect(message.createdAt).toEqual(now);

      vi.useRealTimers();
    });

    it('accepts an order whose amount matches the items total minus the discount', async () => {
      const order = makeOrder({
        amount: 250,
        discount: 50,
        items: [
          { productId: 'product-1', quantity: 2, price: 100 },
          { productId: 'product-2', quantity: 1, price: 100 },
        ],
      });

      await expect(
        service.publishPaymentOrderSafe(order)
      ).resolves.toBeUndefined();

      expect(rabbitMqService.publicMessage).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'orderId is missing',
        { orderId: '' },
        'Invalid payment order: missing orderId',
      ],
      [
        'userId is missing',
        { userId: '' },
        'Invalid payment order: missing userId',
      ],
      [
        'amount is zero',
        { amount: 0 },
        'Invalid payment order: invalid amount',
      ],
      [
        'amount is negative',
        { amount: -1 },
        'Invalid payment order: invalid amount',
      ],
      ['items is empty', { items: [] }, 'Invalid payment order: no items'],
      [
        'amount does not match the items total',
        { amount: 99 },
        'Payment amount does not match order total',
      ],
    ])(
      'rejects the order when %s',
      async (_case, overrides: Partial<PaymentOrderMessage>, reason) => {
        await expect(
          service.publishPaymentOrderSafe(makeOrder(overrides))
        ).rejects.toThrow('Invalid payment order');

        expect(error).toHaveBeenCalledWith(reason);
        expect(rabbitMqService.publicMessage).not.toHaveBeenCalled();
      }
    );

    it('stops at the first validation failure', async () => {
      await expect(
        service.publishPaymentOrderSafe(makeOrder({ orderId: '', userId: '' }))
      ).rejects.toThrow('Invalid payment order');

      expect(error).toHaveBeenCalledWith(
        'Invalid payment order: missing orderId'
      );
      expect(error).not.toHaveBeenCalledWith(
        'Invalid payment order: missing userId'
      );
    });

    it('logs a broker failure without failing the caller', async () => {
      const failure = new Error('broker unreachable');
      rabbitMqService.publicMessage.mockRejectedValue(failure);

      await expect(
        service.publishPaymentOrderSafe(makeOrder())
      ).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Error publishing payment order: ${failure.message}`,
        failure.stack
      );
    });

    it('logs the published order once the broker accepted it', async () => {
      const order = makeOrder();

      await service.publishPaymentOrderSafe(order);

      expect(log).toHaveBeenCalledWith(
        `Payment order published successfully: [ORDER ID]: ${order.orderId}, [AMOUNT ID]: ${order.amount}, [USER ID]: ${order.userId}`
      );
    });
  });
});
