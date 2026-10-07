import type { Cart } from '../entities/cart.entity';
import { CartStatus } from '../enums/cart-status.enum';
import { CartResponseDto } from './cart-response.dto';

const at = (iso: string) => new Date(iso);

describe('CartResponseDto.from', () => {
  it('answers an empty active cart when there is none', () => {
    expect({ ...CartResponseDto.from(null) }).toEqual({
      id: null,
      status: CartStatus.ACTIVE,
      total: 0,
      items: [],
    });
  });

  it('copies the cart and its items, oldest item first', () => {
    const cart = {
      id: 'cart-1',
      userId: 'user-1',
      status: CartStatus.ACTIVE,
      total: 79.6,
      createdAt: at('2026-10-04T12:00:00Z'),
      updatedAt: at('2026-10-04T12:05:00Z'),
      items: [
        {
          id: 'item-2',
          cartId: 'cart-1',
          productId: 'product-2',
          productName: 'Mouse',
          price: 19.9,
          quantity: 1,
          subtotal: 19.9,
          createdAt: at('2026-10-04T12:05:00Z'),
        },
        {
          id: 'item-1',
          cartId: 'cart-1',
          productId: 'product-1',
          productName: 'Keyboard',
          price: 19.9,
          quantity: 3,
          subtotal: 59.7,
          createdAt: at('2026-10-04T12:00:00Z'),
        },
      ],
    } as unknown as Cart;

    const dto = CartResponseDto.from(cart);

    expect(dto).toMatchObject({ id: 'cart-1', status: 'active', total: 79.6 });
    expect(dto.items.map((item) => item.id)).toEqual(['item-1', 'item-2']);
    expect(dto.items[0]).toEqual({
      id: 'item-1',
      productId: 'product-1',
      productName: 'Keyboard',
      price: 19.9,
      quantity: 3,
      subtotal: 59.7,
    });
    expect(dto).not.toHaveProperty('userId');
  });
});
