import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@/auth/authenticated-user';
import { OrderResponseDto } from './dtos/order-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "The user's orders, newest first" })
  @ApiOkResponse({ type: OrderResponseDto, isArray: true })
  async findAll(
    @Req() request: { user: AuthenticatedUser }
  ): Promise<OrderResponseDto[]> {
    const orders = await this.ordersService.findAllByUser(request.user.id);

    return orders.map((order) => OrderResponseDto.from(order));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of the user’s orders' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'The order id is not a UUID' })
  @ApiNotFoundResponse({ description: 'No order with this id is yours' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { user: AuthenticatedUser }
  ): Promise<OrderResponseDto> {
    return OrderResponseDto.from(
      await this.ordersService.findOneByUser(request.user.id, id)
    );
  }
}
