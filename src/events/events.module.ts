import { Module } from '@nestjs/common';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  providers: [RabbitmqService, PaymentQueueService],
})
export class EventsModule {}
