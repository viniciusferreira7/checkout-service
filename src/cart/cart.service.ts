import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { fromCents, MAX_MONEY_CENTS, toCents } from '@/common/money';
import { metrics } from '@/observability/metrics';
import { ProductsClientService } from '@/products-client/products-client.service';
import type { AddCartItemDto } from './dtos/add-cart-item.dto';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartStatus } from './enums/cart-status.enum';

type CartOperation = 'add_item' | 'remove_item';
type CartOutcome =
  | 'succeeded'
  | 'product_not_found'
  | 'out_of_stock'
  | 'too_large'
  | 'item_not_found'
  | 'products_unavailable'
  | 'failed';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    private readonly dataSource: DataSource,
    private readonly productsClient: ProductsClientService
  ) {}

  /** The user's active cart with its items, or null when there is none. */
  findActive(userId: string): Promise<Cart | null> {
    return this.carts.findOne({
      where: { userId, status: CartStatus.ACTIVE },
    });
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<Cart> {
    const startedAt = Date.now();

    try {
      const product = await this.productsClient.getProduct(dto.productId);

      if (!product?.isActive) {
        throw this.refuse(
          'add_item',
          'product_not_found',
          startedAt,
          new NotFoundException('Product not found')
        );
      }

      const cart = await this.dataSource.transaction(async (manager) => {
        const cartId = await this.lockActiveCartId(manager, userId);
        const existing = await manager.findOneBy(CartItem, {
          cartId,
          productId: product.id,
        });
        const quantity = (existing?.quantity ?? 0) + dto.quantity;

        if (quantity > product.stock) {
          throw this.refuse(
            'add_item',
            'out_of_stock',
            startedAt,
            new ConflictException('Not enough stock')
          );
        }

        // The first price stays: the cart shows what the user agreed to.
        const price = existing?.price ?? product.price;
        const subtotalCents = toCents(price) * quantity;

        if (subtotalCents > MAX_MONEY_CENTS) {
          throw this.refuse(
            'add_item',
            'too_large',
            startedAt,
            new ConflictException('Cart total exceeds the maximum')
          );
        }

        await manager.save(
          CartItem,
          manager.create(CartItem, {
            ...(existing ?? {
              cartId,
              productId: product.id,
              productName: product.name,
              price,
            }),
            quantity,
            subtotal: fromCents(subtotalCents),
          })
        );

        await this.refreshTotal(manager, cartId, startedAt);

        return manager.findOneByOrFail(Cart, { id: cartId });
      });

      this.settle('add_item', 'succeeded', startedAt);
      this.logger.log(
        `User ${userId} added product ${product.id} to cart ${cart.id}`
      );

      return cart;
    } catch (error) {
      this.settleUnexpected('add_item', error, startedAt);

      throw error;
    }
  }

  /**
   * Removes one item of the user's active cart. An item that does not exist,
   * belongs to someone else or sits in a finished cart is the same 404, so
   * the answer never reveals that an id exists.
   */
  async removeItem(userId: string, itemId: string): Promise<Cart> {
    const startedAt = Date.now();

    try {
      const cart = await this.dataSource.transaction(async (manager) => {
        const item = await manager
          .getRepository(CartItem)
          .createQueryBuilder('item')
          .innerJoin('item.cart', 'cart')
          .where('item.id = :itemId', { itemId })
          .andWhere('cart.userId = :userId', { userId })
          .andWhere('cart.status = :status', { status: CartStatus.ACTIVE })
          .getOne();

        if (!item) {
          throw this.refuse(
            'remove_item',
            'item_not_found',
            startedAt,
            new NotFoundException('Cart item not found')
          );
        }

        await manager.findOneOrFail(Cart, {
          where: { id: item.cartId },
          loadEagerRelations: false,
          lock: { mode: 'pessimistic_write' },
        });
        // Deleted by id, not by dropping it from `cart.items`: saving the
        // relation would try to null the item's cart_id instead.
        await manager.delete(CartItem, { id: item.id });
        await this.refreshTotal(manager, item.cartId, startedAt);

        return manager.findOneByOrFail(Cart, { id: item.cartId });
      });

      this.settle('remove_item', 'succeeded', startedAt);
      this.logger.log(
        `User ${userId} removed item ${itemId} from cart ${cart.id}`
      );

      return cart;
    } catch (error) {
      this.settleUnexpected('remove_item', error, startedAt);

      throw error;
    }
  }

  /**
   * Locks the user's active cart row for this transaction, creating it first
   * if needed. `ON CONFLICT DO NOTHING` lets a concurrent request win the
   * partial unique index without aborting this transaction; the `FOR UPDATE`
   * read then serialises the two writers on the same row.
   */
  private async lockActiveCartId(
    manager: EntityManager,
    userId: string
  ): Promise<string> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Cart)
      .values({ userId, status: CartStatus.ACTIVE })
      .orIgnore()
      .execute();

    const cart = await manager.findOneOrFail(Cart, {
      where: { userId, status: CartStatus.ACTIVE },
      // A lock cannot sit on the outer join the eager items would add.
      loadEagerRelations: false,
      lock: { mode: 'pessimistic_write' },
    });

    return cart.id;
  }

  /** Recomputes the total from the stored subtotals, in cents. */
  private async refreshTotal(
    manager: EntityManager,
    cartId: string,
    startedAt: number
  ): Promise<void> {
    const items = await manager.findBy(CartItem, { cartId });
    const totalCents = items.reduce(
      (sum, item) => sum + toCents(item.subtotal),
      0
    );

    if (totalCents > MAX_MONEY_CENTS) {
      throw this.refuse(
        'add_item',
        'too_large',
        startedAt,
        new ConflictException('Cart total exceeds the maximum')
      );
    }

    await manager.update(Cart, cartId, { total: fromCents(totalCents) });
  }

  private settle(
    operation: CartOperation,
    outcome: CartOutcome,
    startedAt: number
  ): void {
    metrics.cart_operations.add(1, { operation, outcome });
    metrics.cart_operation_duration.record(Date.now() - startedAt, {
      operation,
      outcome,
    });
  }

  /** Settles a domain refusal once, where it is decided, and hands it back. */
  private refuse<T extends HttpException>(
    operation: CartOperation,
    outcome: CartOutcome,
    startedAt: number,
    exception: T
  ): T {
    this.settle(operation, outcome, startedAt);
    this.logger.warn(`${operation} refused: ${outcome}`);

    return exception;
  }

  /**
   * Domain refusals were settled by `refuse`. A 503 from the products client
   * is its own outcome; anything else is unexpected.
   */
  private settleUnexpected(
    operation: CartOperation,
    error: unknown,
    startedAt: number
  ): void {
    if (error instanceof HttpException) {
      if (error.getStatus() === 503) {
        this.settle(operation, 'products_unavailable', startedAt);
      }

      return;
    }

    this.settle(operation, 'failed', startedAt);
    this.logger.error(
      `${operation} failed unexpectedly`,
      error instanceof Error ? error.stack : undefined
    );
  }
}
