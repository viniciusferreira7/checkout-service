import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { EnvService } from '@/env/env.service';

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
      this.logger.error(
        'Failed to connect on RabbiMq',
        error instanceof Error ? error.stack : undefined
      );

      return;
    }

    try {
      this.channel = await this.connection.createChannel();
      this.logger.log('Created create on RabbitmQ successfully');
    } catch (error) {
      this.logger.error(
        `Failed to create channel on RabbitMQ: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
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
      this.logger.error(
        `Failed to disconnect from RabbitMQ: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }
}
