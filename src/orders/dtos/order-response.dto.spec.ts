import type { Order } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { OrderResponseDto } from './order-response.dto';

describe('OrderResponseDto.from', () => {
  it('copies the order without its owner', () => {
    const order = {
      id: 'order-1',
      userId: 'user-1',
      cartId: 'cart-1',
      total: 59.7,
      status: OrderStatus.PENDING,
      paymentMethod: 'pix',
      createdAt: new Date('2026-10-04T12:00:00Z'),
      updatedAt: new Date('2026-10-04T12:00:00Z'),
    } as Order;

    expect({ ...OrderResponseDto.from(order) }).toEqual({
      id: 'order-1',
      cartId: 'cart-1',
      total: 59.7,
      status: 'pending',
      paymentMethod: 'pix',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  });
});
