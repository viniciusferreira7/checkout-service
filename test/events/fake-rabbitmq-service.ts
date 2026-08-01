import { Logger } from '@nestjs/common';
import type { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';

/**
 * Stand-in for `RabbitmqService` in tests.
 *
 * The real service opens an AMQP connection in `onModuleInit`, so booting the
 * application without a broker would either hang or log a connection error on
 * every spec. This keeps the lifecycle hooks as no-ops and records what the
 * suite asked it to do, so assertions can be made without external infra.
 */
export class FakeRabbitmqService implements Partial<RabbitmqService> {
  private readonly logger = new Logger(FakeRabbitmqService.name);

  connected = false;

  async onModuleInit() {
    this.connected = true;
    this.logger.debug('Fake RabbitMQ connected');
  }

  async onModuleDestroy() {
    this.connected = false;
    this.logger.debug('Fake RabbitMQ disconnected');
  }
}
