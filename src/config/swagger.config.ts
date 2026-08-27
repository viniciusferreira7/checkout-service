import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { checkoutServiceDetails } from '@/utils/checkout-service-details';

export const SWAGGER_PATH = 'api/docs';

/**
 * Describes this service for the OpenAPI document.
 *
 * The description is written flush left on purpose: Swagger UI renders it as
 * markdown, so indented lines would come out as a code block.
 */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Marketplace Checkout Service')
    .setDescription(
      [
        'Cart and order processing for the Marketplace system.',
        '',
        'Responsibilities:',
        '- Holds the cart while a customer is shopping',
        '- Turns a cart into an order at checkout',
        '- Publishes the order for the payments service to charge',
        '',
        'Authentication:',
        '- Use a JWT Bearer token for protected routes',
      ].join('\n')
    )
    .setVersion(checkoutServiceDetails.version)
    .setContact(
      'Marketplace Team',
      'https://marketplace.com',
      'dev@marketplace.com'
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth'
    )
    .addTag('Cart', 'Cart management endpoints')
    .addTag('Orders', 'Order placement and lookup endpoints')
    .addTag('Health', 'Health monitoring endpoints')
    .build();
}

/** Mounts Swagger UI at {@link SWAGGER_PATH}. */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Marketplace Checkout Service Documentation',
    customfavIcon: './favicon',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #3b82f6 }
    `,
  });
}
