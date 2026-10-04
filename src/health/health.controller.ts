import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { checkoutServiceDetails } from '../utils/checkout-service-details';

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Identify the service and report that it is up' })
  @ApiOkResponse({
    description: 'Service is up',
    schema: { example: { status: 'ok', service: 'checkout-service' } },
  })
  health() {
    return { status: 'ok', service: checkoutServiceDetails.name };
  }
}
