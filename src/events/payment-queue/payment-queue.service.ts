import { Injectable, Logger } from '@nestjs/common';
import { checkoutServiceDetails } from '@/utils/checkout-service-details';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type { MetadataMessage } from './metadata-message.interface';

interface EnrichmentMessage extends PaymentOrderMessage {
  metadata: MetadataMessage;
}

@Injectable()
export class PaymentQueueService {
  private readonly logger = new Logger(PaymentQueueService.name);

  private readonly ROUTING_KEY = 'payment.order';
  private readonly EXCHANGE = 'payments';

  constructor(private readonly rabbitMqService: RabbitmqService) {}

  private async publishPaymentOrder(paymentOrder: PaymentOrderMessage) {
    this.logger.log(
      `Publishing payment order for orderId: ${paymentOrder.orderId}`
    );

    try {
      const enrichmentMessage: EnrichmentMessage = {
        ...paymentOrder,
        createdAt: paymentOrder.createdAt ?? new Date(),
        metadata: {
          version: checkoutServiceDetails.version,
          name: checkoutServiceDetails.name,
          timestamp: new Date().toISOString(),
        },
      };

      await this.rabbitMqService.publicMessage({
        exchange: this.EXCHANGE,
        routingKey: this.ROUTING_KEY,
        message: enrichmentMessage,
      });

      this.logger.log(
        `Payment order published successfully: [ORDER ID]: ${paymentOrder.orderId}, [AMOUNT ID]: ${paymentOrder.amount}, [USER ID]: ${paymentOrder.userId}`
      );

      this.logger.debug(
        `Payment order details: ${JSON.stringify(enrichmentMessage)}`
      );
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Error publishing payment order: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  private validatePaymentOrder(paymentOrder: PaymentOrderMessage): boolean {
    if (!paymentOrder.orderId) {
      this.logger.error('Invalid payment order: missing orderId');

      return false;
    }

    if (!paymentOrder.userId) {
      this.logger.error('Invalid payment order: missing userId');

      return false;
    }

    if (!paymentOrder.amount || paymentOrder.amount <= 0) {
      this.logger.error('Invalid payment order: invalid amount');

      return false;
    }

    if (!paymentOrder.items || paymentOrder.items.length === 0) {
      this.logger.error('Invalid payment order: no items');

      return false;
    }

    return true;
  }

  public async publishPaymentOrderSafe(
    paymentOrder: PaymentOrderMessage
  ): Promise<void> {
    if (!this.validatePaymentOrder(paymentOrder)) {
      throw new Error('Invalid payment order');
    }

    await this.publishPaymentOrder(paymentOrder);
  }
}
