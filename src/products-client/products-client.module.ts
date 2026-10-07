import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { EnvService } from '@/env/env.service';
import { ProductsClientService } from './products-client.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        baseURL: env.get('PRODUCTS_SERVICE_URL'),
        timeout: 5_000,
        // An internal service never redirects; following one would let it
        // point the request anywhere.
        maxRedirects: 0,
      }),
    }),
  ],
  providers: [ProductsClientService],
  exports: [ProductsClientService],
})
export class ProductsClientModule {}
