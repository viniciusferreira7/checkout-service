import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsClientModule } from '@/products-client/products-client.module';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Cart, CartItem]), ProductsClientModule],
  providers: [CartService],
  exports: [TypeOrmModule, CartService],
})
export class CartModule {}
