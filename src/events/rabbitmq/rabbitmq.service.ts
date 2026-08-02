import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { EnvService } from '@/env/env.service';
import { getErrorDetails } from '@/utils/error.util';
import type { PublicMessageParams } from '../interfaces/public-menssage.interface';

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
      this.logger.error(
        `Failed to connect on RabbiMQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      return;
    }

    try {
      this.channel = await this.connection.createChannel();
      this.logger.log('Created create on RabbitmQ successfully');
    } catch (error) {
      const errorDetails = getErrorDetails(error);

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

  public async publicMessage({
    exchange,
    routingKey,
    message,
  }: PublicMessageParams): Promise<void> {
    try {
      if (!this.channel) {
        this.logger.warn(
          'RabbiMq channel not available, skipping message publish'
        );

        return;
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const publishedMessage = await this.channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          contentType: 'application/json',
        }
      );

      if (!publishedMessage)
        throw new Error('Failed to publish message to RabbiMQ');

      this.logger.log(
        `Message was published to [EXCHANGE]: ${exchange} - [ROUTING KEY]: ${routingKey}`
      );
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      this.logger.error(
        `Error publishing message to RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }
}
