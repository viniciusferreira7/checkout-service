import { ApiProperty } from '@nestjs/swagger';
import type { Cart } from '../entities/cart.entity';
import { CartStatus } from '../enums/cart-status.enum';

export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty({ example: 'Mechanical keyboard' })
  productName: string;

  @ApiProperty({ example: 19.9, description: 'Price when the item was added' })
  price: number;

  @ApiProperty({ example: 3 })
  quantity: number;

  @ApiProperty({ example: 59.7 })
  subtotal: number;
}

/**
 * The cart as the client sees it. Built field by field, so the owner id and
 * anything added to the entity later never leak. `id` is null for the empty
 * cart answered to a user who has none yet.
 */
export class CartResponseDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  id: string | null;

  @ApiProperty({ enum: CartStatus })
  status: CartStatus;

  @ApiProperty({ example: 59.7 })
  total: number;

  @ApiProperty({ type: CartItemResponseDto, isArray: true })
  items: CartItemResponseDto[];

  @ApiProperty({ required: false })
  createdAt?: Date;

  @ApiProperty({ required: false })
  updatedAt?: Date;

  static from(cart: Cart | null): CartResponseDto {
    const dto = new CartResponseDto();

    if (!cart) {
      dto.id = null;
      dto.status = CartStatus.ACTIVE;
      dto.total = 0;
      dto.items = [];

      return dto;
    }

    dto.id = cart.id;
    dto.status = cart.status;
    dto.total = cart.total;
    dto.items = [...(cart.items ?? [])]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.subtotal,
      }));
    dto.createdAt = cart.createdAt;
    dto.updatedAt = cart.updatedAt;

    return dto;
  }
}
