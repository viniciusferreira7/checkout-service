import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartModule } from '@/cart/cart.module';
import { EventsModule } from '@/events/events.module';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order]), CartModule, EventsModule],
  providers: [OrdersService],
  exports: [TypeOrmModule],
})
export class OrdersModule {}
