import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export const MAX_QUANTITY_PER_ADD = 99;

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: MAX_QUANTITY_PER_ADD })
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY_PER_ADD)
  quantity: number;
}
