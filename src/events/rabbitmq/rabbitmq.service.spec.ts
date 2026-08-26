import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { RabbitmqService } from './rabbitmq.service';

const { amqpConnect } = vi.hoisted(() => ({ amqpConnect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpConnect }));

const silence = () => undefined;

const RABBITMQ_URL = 'amqp://test:test@localhost:5672';

describe('RabbitmqService', () => {
  let service: RabbitmqService;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(silence);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(silence);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(silence);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(silence);

    const envService = {
      get: vi.fn().mockReturnValue(RABBITMQ_URL),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitmqService,
        { provide: EnvService, useValue: envService },
      ],
    }).compile();

    service = module.get<RabbitmqService>(RabbitmqService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    amqpConnect.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('opens a connection and a channel with the configured URL', async () => {
      const channel = {};
      const createChannel = vi.fn().mockResolvedValue(channel);
      amqpConnect.mockResolvedValue({ createChannel });

      await service.onModuleInit();

      expect(amqpConnect).toHaveBeenCalledWith(RABBITMQ_URL);
      expect(service.getChannel()).toBe(channel);
      expect(log).toHaveBeenCalledWith('Connected on RabbitmQ successfully');
      expect(log).toHaveBeenCalledWith('Created on RabbitmQ successfully');
    });

    it('logs the failure and leaves the channel closed when the broker is down', async () => {
      const failure = new Error('ECONNREFUSED');
      amqpConnect.mockRejectedValue(failure);

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Failed to connect on RabbiMQ: ${failure.message}`,
        failure.stack
      );
      expect(service.getChannel()).toBeUndefined();
    });

    it('does not try to open a channel once the connection failed', async () => {
      amqpConnect.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.onModuleInit();

      expect(log).not.toHaveBeenCalledWith('Created on RabbitmQ successfully');
    });

    it('keeps the connection when only the channel could not be created', async () => {
      const failure = new Error('channel error');
      const connection = {
        createChannel: vi.fn().mockRejectedValue(failure),
      };
      amqpConnect.mockResolvedValue(connection);

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(service.getConnection()).toBe(connection);
      expect(service.getChannel()).toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        `Failed to create channel on RabbitMQ: ${failure.message}`,
        failure.stack
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('closes the channel before the connection', async () => {
      const order: string[] = [];
      const channelClose = vi.fn(async () => {
        order.push('channel');
      });
      const connectionClose = vi.fn(async () => {
        order.push('connection');
      });

      amqpConnect.mockResolvedValue({
        createChannel: vi.fn().mockResolvedValue({ close: channelClose }),
        close: connectionClose,
      });
      await service.onModuleInit();

      await service.onModuleDestroy();

      expect(order).toEqual(['channel', 'connection']);
      expect(log).toHaveBeenCalledWith('RabbitMQ channel service was closed');
      expect(log).toHaveBeenCalledWith('RabbitMQ service was disconnected');
    });

    it('is a no-op when the broker was never reached', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(error).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalledWith(
        'RabbitMQ channel service was closed'
      );
      expect(log).not.toHaveBeenCalledWith('RabbitMQ service was disconnected');
    });

    it('logs a failed shutdown instead of throwing', async () => {
      const failure = new Error('channel already closed');
      amqpConnect.mockResolvedValue({
        createChannel: vi
          .fn()
          .mockResolvedValue({ close: vi.fn().mockRejectedValue(failure) }),
        close: vi.fn(),
      });
      await service.onModuleInit();

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Failed to disconnect from RabbitMQ: ${failure.message}`,
        failure.stack
      );
    });
  });

  describe('publicMessage', () => {
    const params = {
      exchange: 'payments',
      routingKey: 'payment.order',
      message: { orderId: 'order-1' },
    };

    function givenChannel(overrides: Record<string, unknown> = {}) {
      const channel = {
        assertExchange: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockReturnValue(true),
        ...overrides,
      };

      Reflect.set(service, 'channel', channel);

      return channel;
    }

    it('skips publishing when the channel is not available', async () => {
      await expect(service.publicMessage(params)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(
        'RabbiMq channel not available, skipping message publish'
      );
    });

    it('asserts a durable topic exchange before publishing', async () => {
      const channel = givenChannel();

      await service.publicMessage(params);

      expect(channel.assertExchange).toHaveBeenCalledWith(
        params.exchange,
        'topic',
        { durable: true }
      );
    });

    it('publishes the message as a persistent JSON buffer', async () => {
      const channel = givenChannel();

      await service.publicMessage(params);

      expect(channel.publish).toHaveBeenCalledWith(
        params.exchange,
        params.routingKey,
        Buffer.from(JSON.stringify(params.message)),
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
          timestamp: expect.any(Number),
        })
      );
      expect(log).toHaveBeenCalledWith(
        `Message was published to [EXCHANGE]: ${params.exchange} - [ROUTING KEY]: ${params.routingKey}`
      );
    });

    it('logs when the broker refuses the message', async () => {
      givenChannel({ publish: vi.fn().mockReturnValue(false) });

      await expect(service.publicMessage(params)).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        'Error publishing message to RabbitMQ: Failed to publish message to RabbiMQ',
        expect.any(String)
      );
    });

    it('swallows a broker error so the caller is not taken down', async () => {
      const failure = new Error('exchange mismatch');
      givenChannel({ assertExchange: vi.fn().mockRejectedValue(failure) });

      await expect(service.publicMessage(params)).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Error publishing message to RabbitMQ: ${failure.message}`,
        failure.stack
      );
    });
  });

  describe('subscribeToQueue', () => {
    const subscription = {
      queueName: 'payment_queue',
      exchange: 'payments',
      routingKey: 'payment.order',
      callback: vi.fn().mockResolvedValue(undefined),
    };

    function givenChannel(overrides: Record<string, unknown> = {}) {
      let onMessage: ((message: unknown) => Promise<void>) | undefined;

      const channel = {
        assertExchange: vi.fn().mockResolvedValue(undefined),
        assertQueue: vi
          .fn()
          .mockResolvedValue({ queue: subscription.queueName }),
        bindQueue: vi.fn().mockResolvedValue(undefined),
        prefetch: vi.fn().mockResolvedValue(undefined),
        consume: vi.fn(async (_queue: string, handler: typeof onMessage) => {
          onMessage = handler;
        }),
        ack: vi.fn(),
        nack: vi.fn(),
        ...overrides,
      };

      Reflect.set(service, 'channel', channel);

      return {
        channel,
        deliver: (message: unknown) => onMessage?.(message),
      };
    }

    function makeDelivery(payload: unknown) {
      return { content: Buffer.from(JSON.stringify(payload)) };
    }

    beforeEach(() => {
      subscription.callback.mockClear();
    });

    it('binds a durable queue to the exchange and consumes one message at a time', async () => {
      const { channel } = givenChannel();

      await service.subscribeToQueue(subscription);

      expect(channel.assertExchange).toHaveBeenCalledWith(
        subscription.exchange,
        'topic',
        { durable: true }
      );
      expect(channel.assertQueue).toHaveBeenCalledWith(
        subscription.queueName,
        expect.objectContaining({
          durable: true,
          arguments: {
            'x-message-ttl': 86_400_000,
            'x-max-length': 10_000,
          },
        })
      );
      expect(channel.bindQueue).toHaveBeenCalledWith(
        subscription.queueName,
        subscription.exchange,
        subscription.routingKey
      );
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      expect(channel.consume).toHaveBeenCalledWith(
        subscription.queueName,
        expect.any(Function)
      );
    });

    it('acknowledges a message once the callback resolves', async () => {
      const { channel, deliver } = givenChannel();
      await service.subscribeToQueue(subscription);

      const delivery = makeDelivery({ orderId: 'order-1' });
      await deliver(delivery);

      expect(subscription.callback).toHaveBeenCalledTimes(1);
      expect(channel.ack).toHaveBeenCalledWith(delivery);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it('hands the callback the raw buffer serialisation, not the parsed order', async () => {
      const { deliver } = givenChannel();
      await service.subscribeToQueue(subscription);

      await deliver(makeDelivery({ orderId: 'order-1' }));

      expect(subscription.callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Buffer', data: expect.any(Array) })
      );
    });

    it('rejects the message without requeueing when the callback throws', async () => {
      const failure = new Error('handler exploded');
      subscription.callback.mockRejectedValueOnce(failure);

      const { channel, deliver } = givenChannel();
      await service.subscribeToQueue(subscription);

      const delivery = makeDelivery({ orderId: 'order-1' });
      await deliver(delivery);

      expect(channel.nack).toHaveBeenCalledWith(delivery, false, false);
      expect(channel.ack).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        `Error to processing message: ${failure.message}`,
        failure.stack
      );
    });

    it('ignores a cancelled consumer', async () => {
      const { channel, deliver } = givenChannel();
      await service.subscribeToQueue(subscription);

      await deliver(null);

      expect(subscription.callback).not.toHaveBeenCalled();
      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it('logs the failure instead of throwing when the broker was never reached', async () => {
      await expect(
        service.subscribeToQueue(subscription)
      ).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          `Error subscribing to queue ${subscription.queueName}:`
        ),
        expect.anything()
      );
    });

    it('logs a broker failure while setting the queue up', async () => {
      const failure = new Error('channel closed');
      givenChannel({ assertQueue: vi.fn().mockRejectedValue(failure) });

      await expect(
        service.subscribeToQueue(subscription)
      ).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        `Error subscribing to queue ${subscription.queueName}: ${failure.message}`,
        failure.stack
      );
    });
  });
});
