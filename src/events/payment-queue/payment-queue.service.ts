import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@/env/env.service';
import { metrics } from '@/observability/metrics';
import { checkoutServiceDetails } from '@/utils/checkout-service-details';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type { MetadataMessage } from './metadata-message.interface';

const KNOWN_PAYMENT_METHODS = new Set([
  'credit_card',
  'debit_card',
  'pix',
  'boleto',
]);

/**
 * `paymentMethod` arrives unchecked, so as a metric attribute it is bucketed
 * into a closed set: every distinct raw value would mint its own series.
 */
export function paymentMethodBucket(value: string): string {
  return KNOWN_PAYMENT_METHODS.has(value) ? value : 'other';
}

interface EnrichmentMessage extends PaymentOrderMessage {
  metadata: MetadataMessage;
}

@Injectable()
export class PaymentQueueService {
  private readonly logger = new Logger(PaymentQueueService.name);

  constructor(
    private readonly rabbitMqService: RabbitmqService,
    private readonly envService: EnvService
  ) {}

  /**
   * Records how one publish ended. `outcome` stays a closed set: the order id
   * belongs in the log line, where high cardinality is free, and as an
   * attribute here it would mint a time series per order.
   */
  private settle(outcome: 'succeeded' | 'failed', startedAt: number): void {
    metrics.payment_orders_published.add(1, { outcome });
    metrics.payment_order_publish_duration.record(Date.now() - startedAt, {
      outcome,
    });
  }

  private async publishPaymentOrder(paymentOrder: PaymentOrderMessage) {
    const startedAt = Date.now();

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
        routingKey: this.envService.get('RABBITMQ_ROUTING_KEY_PAYMENT_ORDER'),
        exchange: this.envService.get('RABBITMQ_EXCHANGE'),
        message: enrichmentMessage,
      });

      this.logger.log(
        `Payment order published successfully: [ORDER ID]: ${paymentOrder.orderId}, [AMOUNT ID]: ${paymentOrder.amount}, [USER ID]: ${paymentOrder.userId}`
      );

      this.logger.debug(
        `Payment order details: ${JSON.stringify(enrichmentMessage)}`
      );

      this.settle('succeeded', startedAt);
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.settle('failed', startedAt);

      this.logger.error(
        `Error publishing payment order: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  private validatePaymentOrder(paymentOrder: PaymentOrderMessage): boolean {
    if (!paymentOrder.orderId) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_order_id' });
      this.logger.error('Invalid payment order: missing orderId');

      return false;
    }

    if (!paymentOrder.userId) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_user_id' });
      this.logger.error('Invalid payment order: missing userId');

      return false;
    }

    if (!paymentOrder.amount || paymentOrder.amount <= 0) {
      metrics.payment_orders_rejected.add(1, { reason: 'invalid_amount' });
      this.logger.error('Invalid payment order: invalid amount');

      return false;
    }

    if (!paymentOrder.items || paymentOrder.items.length === 0) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_items' });
      this.logger.error('Invalid payment order: no items');

      return false;
    }

    const itemsTotal = paymentOrder.items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0
    );

    const expectedAmount = itemsTotal - paymentOrder.discount;

    if (paymentOrder.amount !== expectedAmount) {
      metrics.payment_orders_rejected.add(1, { reason: 'amount_mismatch' });
      this.logger.error('Payment amount does not match order total');
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

    metrics.payment_order_amount.record(paymentOrder.amount, {
      payment_method: paymentMethodBucket(paymentOrder.paymentMethod),
    });

    await this.publishPaymentOrder(paymentOrder);
  }
}
