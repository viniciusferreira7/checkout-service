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
    try {
      const rabbitMqUrl = this.envService.get('RABBITMQ_URL');

      await Promise.all([
        amqp.connect(rabbitMqUrl),
        this.connection.createChannel(),
      ]);

      this.logger.log('Connected on RabbitmQ successfully');
      this.logger.log('Created channel on RabbitmQ successfully');
    } catch (error) {
      this.logger.error('Failed to connect on RabbiMq', error);
    }
  }

  private async disconnect() {
    try {
      await Promise.all([
        this.channel ? this.channel.close() : Promise.resolve(),
        this.connection ? this.connection.close() : Promise.resolve(),
      ]);

      this.logger.log('RabbitMQ service was disconnect');
    } catch (error) {
      this.logger.error('Failed to disconnect from RabbitMq', error);
    }
  }
}
