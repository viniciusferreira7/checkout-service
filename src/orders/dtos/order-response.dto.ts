import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_METHODS } from '@/common/payment-methods';
import type { Order } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';

/**
 * The order as its owner sees it. Built field by field, so the owner id and
 * anything added to the entity later never leak.
 */
export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'The cart it came from' })
  cartId: string;

  @ApiProperty({ example: 59.7 })
  total: number;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: PAYMENT_METHODS })
  paymentMethod: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static from(order: Order): OrderResponseDto {
    const dto = new OrderResponseDto();

    dto.id = order.id;
    dto.cartId = order.cartId;
    dto.total = order.total;
    dto.status = order.status;
    dto.paymentMethod = order.paymentMethod;
    dto.createdAt = order.createdAt;
    dto.updatedAt = order.updatedAt;

    return dto;
  }
}
