import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { decimalToNumberTransformer } from '../../common/transformers/decimal-to-number.transformer';
import { CartStatus } from '../enums/cart-status.enum';
import { CartItem } from './cart-item.entity';

@Entity('carts')
// At most one active cart per user, enforced where concurrent requests meet.
@Index('UQ_carts_user_active', ['userId'], {
  unique: true,
  where: `"status" = 'active'`,
})
// Postgres sorts NaN above every number, so `>= 0` alone would accept it.
@Check('CHK_carts_total_non_negative', `"total" >= 0 AND "total" <> 'NaN'`)
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Users live in the users service's database: no foreign key. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: CartStatus,
    enumName: 'cart_status',
    default: CartStatus.ACTIVE,
  })
  status: CartStatus;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: decimalToNumberTransformer,
  })
  total: number;

  @OneToMany(
    () => CartItem,
    (item) => item.cart,
    { cascade: true, eager: true }
  )
  items: Relation<CartItem[]>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
