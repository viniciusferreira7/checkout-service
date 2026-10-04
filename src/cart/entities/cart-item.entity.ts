import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { decimalToNumberTransformer } from '../../common/transformers/decimal-to-number.transformer';
import { Cart } from './cart.entity';

const money = {
  type: 'decimal',
  precision: 10,
  scale: 2,
  transformer: decimalToNumberTransformer,
} as const;

@Entity('cart_items')
// One row per product: adding it again raises the quantity instead.
@Unique('UQ_cart_items_cart_product', ['cartId', 'productId'])
@Check('CHK_cart_items_price_non_negative', `"price" >= 0 AND "price" <> 'NaN'`)
@Check('CHK_cart_items_quantity_positive', '"quantity" >= 1')
@Check(
  'CHK_cart_items_subtotal_non_negative',
  `"subtotal" >= 0 AND "subtotal" <> 'NaN'`
)
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(
    () => Cart,
    (cart) => cart.items,
    { onDelete: 'CASCADE' }
  )
  @JoinColumn({ name: 'cart_id' })
  cart: Relation<Cart>;

  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  /** Products live in the products service's database: no foreign key. */
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Snapshot taken when the item was added; never refreshed. */
  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName: string;

  /** Snapshot taken when the item was added; never refreshed. */
  @Column(money)
  price: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column(money)
  subtotal: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
