import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@/auth/authenticated-user';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dtos/add-cart-item.dto';
import { CartResponseDto } from './dtos/cart-response.dto';

@ApiTags('Cart')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({
    summary: "The user's active cart",
    description: 'An empty cart (id null) when the user has none yet.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  async getCart(
    @Req() request: { user: AuthenticatedUser }
  ): Promise<CartResponseDto> {
    return CartResponseDto.from(
      await this.cartService.findActive(request.user.id)
    );
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a product to the cart',
    description:
      'Adding a product already in the cart raises its quantity. Name and price are saved as they are now.',
  })
  @ApiCreatedResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({ description: 'The body failed validation' })
  @ApiNotFoundResponse({ description: 'No active product has this id' })
  @ApiConflictResponse({
    description: 'Not enough stock, or the total would exceed the maximum',
  })
  @ApiServiceUnavailableResponse({
    description: 'The products service is unavailable',
  })
  async addItem(
    @Body() dto: AddCartItemDto,
    @Req() request: { user: AuthenticatedUser }
  ): Promise<CartResponseDto> {
    return CartResponseDto.from(
      await this.cartService.addItem(request.user.id, dto)
    );
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove an item from the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({ description: 'The item id is not a UUID' })
  @ApiNotFoundResponse({ description: 'No item with this id in your cart' })
  async removeItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: { user: AuthenticatedUser }
  ): Promise<CartResponseDto> {
    return CartResponseDto.from(
      await this.cartService.removeItem(request.user.id, itemId)
    );
  }
}
