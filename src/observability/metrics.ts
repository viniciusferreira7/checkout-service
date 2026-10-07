import { defineMetrics } from '@viniciusferreira7/signals';

export const metrics = defineMetrics(
  {
    payment_orders_published: {
      kind: 'counter',
      description:
        'Payment orders published to the broker, by how they settled',
    },
    payment_order_publish_duration: {
      kind: 'histogram',
      description: 'Time spent publishing one payment order',
      unit: 'ms',
    },
    payment_orders_rejected: {
      kind: 'counter',
      description:
        'Payment orders refused before publishing, by validation reason',
    },
    payment_order_amount: {
      kind: 'histogram',
      description: 'Amount of each payment order accepted for publishing',
      unit: '{amount}',
    },
    queue_messages_consumed: {
      kind: 'counter',
      description: 'Messages taken off a queue, by queue and how they settled',
    },
    queue_message_processing_duration: {
      kind: 'histogram',
      description: 'Time spent handling one consumed message',
      unit: 'ms',
    },
    broker_connection_attempts: {
      kind: 'counter',
      description: 'RabbitMQ connection attempts, by outcome',
    },
    broker_publish_failures: {
      kind: 'counter',
      description: 'Messages this service failed to publish to the broker',
    },
    products_client_requests: {
      kind: 'counter',
      description: 'Product lookups on the products service, by outcome',
    },
    cart_operations: {
      kind: 'counter',
      description: 'Cart changes, by operation and outcome',
    },
    cart_operation_duration: {
      kind: 'histogram',
      description: 'Time spent on one cart change',
      unit: 'ms',
    },
    orders_placed: {
      kind: 'counter',
      description: 'Checkout attempts, by how they settled and payment method',
    },
    order_total: {
      kind: 'histogram',
      description: 'Total of each order placed',
      unit: '{amount}',
    },
  },
  'checkout-service'
);
