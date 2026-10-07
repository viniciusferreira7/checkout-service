import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { Cart } from '@/cart/entities/cart.entity';
import { CartItem } from '@/cart/entities/cart-item.entity';
import { CartStatus } from '@/cart/enums/cart-status.enum';
import type { PaymentMethod } from '@/common/payment-methods';
import { PaymentQueueService } from '@/events/payment-queue/payment-queue.service';
import { getErrorDetails } from '@/utils/error.util';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly paymentQueue: PaymentQueueService
  ) {}

  /** The user's orders, newest first; the id breaks ties so pages are stable. */
  findAllByUser(userId: string): Promise<Order[]> {
    return this.orders.find({
      where: { userId },
      order: { createdAt: 'DESC', id: 'ASC' },
    });
  }

  /**
   * One of the user's orders. Someone else's order is the same 404 as a
   * missing one, so the answer never reveals that an id exists.
   */
  async findOneByUser(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOneBy({ id: orderId, userId });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /**
   * Turns the user's active cart into a pending order. Completing the cart
   * and creating the order share one transaction; the payment order is
   * published only after it commits, so the broker never hears of an order
   * that was rolled back.
   */
  async checkout(userId: string, paymentMethod: PaymentMethod): Promise<Order> {
    const { order, items } = await this.dataSource.transaction(
      async (manager) => {
        // A second checkout waits on this lock and then finds the cart
        // completed: no row matches, so it answers "Cart is empty".
        const cart = await manager.findOne(Cart, {
          where: { userId, status: CartStatus.ACTIVE },
          // A lock cannot sit on the outer join the eager items would add.
          loadEagerRelations: false,
          lock: { mode: 'pessimistic_write' },
        });
        const items = cart
          ? await manager.findBy(CartItem, { cartId: cart.id })
          : [];

        if (!cart || items.length === 0) {
          throw new BadRequestException('Cart is empty');
        }

        await manager.update(Cart, cart.id, { status: CartStatus.COMPLETED });

        const order = await manager.save(
          Order,
          manager.create(Order, {
            userId,
            cartId: cart.id,
            total: cart.total,
            paymentMethod,
            status: OrderStatus.PENDING,
          })
        );

        return { order, items };
      }
    );

    this.logger.log(
      `User ${userId} placed order ${order.id} from cart ${order.cartId}`
    );

    await this.publishPayment(order, items);

    return order;
  }

  /**
   * The order is already committed: a message that fails to go out is
   * logged and left for a later resend (no outbox yet), never turned into an
   * error for a client whose order exists.
   */
  private async publishPayment(order: Order, items: CartItem[]): Promise<void> {
    try {
      await this.paymentQueue.publishPaymentOrderSafe({
        orderId: order.id,
        userId: order.userId,
        amount: order.total,
        discount: 0,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        })),
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
      });
    } catch (error) {
      const details = getErrorDetails(error);

      this.logger.error(
        `Payment order for order ${order.id} was not published`,
        details.stack
      );
    }
  }
}
