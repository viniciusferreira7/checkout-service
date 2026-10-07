import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@/auth/authenticated-user';
import { CheckoutDto } from './dtos/checkout.dto';
import { OrderResponseDto } from './dtos/order-response.dto';
import { OrdersService } from './orders.service';

/**
 * Lives under /cart but in the orders module: checkout creates an order, and
 * keeping it here spares the cart module a dependency on orders.
 */
@ApiTags('Cart')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@Controller('cart')
export class CheckoutController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Turn the active cart into an order',
    description:
      'The order starts pending; the payment is processed asynchronously.',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({
    description: 'The cart is empty, or the payment method is not accepted',
  })
  async checkout(
    @Body() dto: CheckoutDto,
    @Req() request: { user: AuthenticatedUser }
  ): Promise<OrderResponseDto> {
    return OrderResponseDto.from(
      await this.ordersService.checkout(request.user.id, dto.paymentMethod)
    );
  }
}
