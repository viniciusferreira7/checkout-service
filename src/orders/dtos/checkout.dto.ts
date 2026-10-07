import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PAYMENT_METHODS, type PaymentMethod } from '@/common/payment-methods';

export class CheckoutDto {
  @ApiProperty({ enum: PAYMENT_METHODS, example: 'pix' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod: PaymentMethod;
}
