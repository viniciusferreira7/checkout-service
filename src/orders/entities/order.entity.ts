import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalToNumberTransformer } from '../../common/transformers/decimal-to-number.transformer';
import { OrderStatus } from '../enums/order-status.enum';

@Entity('orders')
// Serves "my orders, newest first".
@Index('IDX_orders_user_created', ['userId', 'createdAt'])
@Check('CHK_orders_total_non_negative', `"total" >= 0 AND "total" <> 'NaN'`)
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** The cart it came from; no foreign key, so the order outlives the cart. */
  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalToNumberTransformer,
  })
  total: number;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({ name: 'payment_method', type: 'varchar', length: 50 })
  paymentMethod: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
