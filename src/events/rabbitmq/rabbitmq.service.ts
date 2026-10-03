import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { EnvService } from '@/env/env.service';
import { metrics } from '@/observability/metrics';
import { getErrorDetails } from '@/utils/error.util';
import type { PublicMessageParams } from '../interfaces/public-message.interface';
import type { SubscribeToQueue } from '../interfaces/subscribe-to-queue.interface';

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;

  constructor(private readonly envService: EnvService) {}

  public getChannel(): amqp.Channel {
    return this.channel;
  }

  public getConnection(): amqp.ChannelModel {
    return this.connection;
  }

  async onModuleDestroy() {
    await this.disconnect();
  }
  async onModuleInit() {
    await this.connect();
  }

  private async connect() {
    const rabbitMqUrl = this.envService.get('RABBITMQ_URL');

    try {
      this.connection = await amqp.connect(rabbitMqUrl);
      this.logger.log('Connected on RabbitmQ successfully');
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      metrics.broker_connection_attempts.add(1, { outcome: 'refused' });

      this.logger.error(
        `Failed to connect on RabbiMQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      return;
    }

    try {
      this.channel = await this.connection.createChannel();
      this.logger.log('Created on RabbitmQ successfully');

      metrics.broker_connection_attempts.add(1, { outcome: 'connected' });
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      metrics.broker_connection_attempts.add(1, { outcome: 'no_channel' });

      this.logger.error(
        `Failed to create channel on RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  private async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.logger.log('RabbitMQ channel service was closed');
      }
      if (this.connection) {
        await this.connection.close();
        this.logger.log('RabbitMQ service was disconnected');
      }
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      this.logger.error(
        `Failed to disconnect from RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  /**
   * Never rejects, so a broker problem cannot take the caller down. Answers
   * whether the message actually left: `false` means it was dropped (no
   * channel, full write buffer or a broker error) and the caller decides what
   * a lost message means for it.
   */
  public async publicMessage({
    exchange,
    routingKey,
    message,
  }: PublicMessageParams): Promise<boolean> {
    try {
      if (!this.channel) {
        metrics.broker_publish_failures.add(1, {
          exchange,
          reason: 'no_channel',
        });

        this.logger.warn(
          'RabbiMq channel not available, skipping message publish'
        );

        return false;
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const publishedMessage = this.channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          contentType: 'application/json',
        }
      );

      if (!publishedMessage) {
        metrics.broker_publish_failures.add(1, {
          exchange,
          reason: 'write_buffer_full',
        });

        throw new Error('Failed to publish message to RabbiMQ');
      }

      this.logger.log(
        `Message was published to [EXCHANGE]: ${exchange} - [ROUTING KEY]: ${routingKey}`
      );
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);

      return true;
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      // A full write buffer already counted itself with its own reason.
      if (errorDetails.message !== 'Failed to publish message to RabbiMQ') {
        metrics.broker_publish_failures.add(1, { exchange, reason: 'error' });
      }

      this.logger.error(
        `Error publishing message to RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      return false;
    }
  }

  /**
   * Records how one delivery ended. Attributes stay a closed set: the queue is
   * configuration, the outcome is one of two words, and the message body never
   * becomes either.
   */
  private settleDelivery(
    queue: string,
    outcome: 'processed' | 'rejected',
    startedAt: number
  ): void {
    metrics.queue_messages_consumed.add(1, { queue, outcome });
    metrics.queue_message_processing_duration.record(Date.now() - startedAt, {
      queue,
      outcome,
    });
  }

  public async subscribeToQueue({
    queueName,
    exchange,
    routingKey,
    callback,
  }: SubscribeToQueue): Promise<void> {
    try {
      await this.channel.assertExchange(exchange, 'topic', { durable: true });

      const queue = await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 86_400_000, // 24 hours
          'x-max-length': 10_000, // 10 thousand seconds
        },
      });

      await this.channel.bindQueue(queue.queue, exchange, routingKey);

      await this.channel.prefetch(1);

      await this.channel.consume(queue.queue, async (msm) => {
        if (msm) {
          const startedAt = Date.now();

          try {
            const messageIntoJson = msm.content.toJSON();
            this.logger.log(`Message received from queue: ${queueName}`);
            this.logger.debug(`Message content: ${messageIntoJson}`);
            await callback(msm.content.toJSON());

            this.channel.ack(msm);

            this.settleDelivery(queueName, 'processed', startedAt);

            this.logger.log(
              `Message processed successfully from queue: ${queueName}`
            );
          } catch (error) {
            const errorDetails = getErrorDetails(error);
            this.logger.error(
              `Error to processing message: ${errorDetails.message}`,
              errorDetails.stack
            );

            this.channel.nack(msm, false, false); //TODO: Add into a DLQ (Dead Letter Queue)

            this.settleDelivery(queueName, 'rejected', startedAt);
          }
        }

        this.logger.log(
          `Subscribed to queue: ${queueName} with routing key: ${routingKey}`
        );
      });
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Error subscribing to queue ${queueName}: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }
}
