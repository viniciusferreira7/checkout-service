import { HttpService } from '@nestjs/axios';
import {
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { metrics } from '@/observability/metrics';
import {
  type ProductSnapshot,
  productSnapshotSchema,
} from './product-snapshot';

@Injectable()
export class ProductsClientService {
  private readonly logger = new Logger(ProductsClientService.name);

  constructor(private readonly http: HttpService) {}

  /**
   * `null` when the products service answers 404 — which it does for a
   * product that does not exist and for one that is inactive. Anything else
   * that is not a well-formed product is a 503: the cart cannot tell whether
   * the product is valid, and the downstream detail is never forwarded.
   */
  async getProduct(productId: string): Promise<ProductSnapshot | null> {
    let data: unknown;

    try {
      ({ data } = await firstValueFrom(
        this.http.get(`/products/${encodeURIComponent(productId)}`)
      ));
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.status === HttpStatus.NOT_FOUND
      ) {
        metrics.products_client_requests.add(1, { outcome: 'not_found' });

        return null;
      }

      throw this.unavailable(
        isAxiosError(error)
          ? `status ${error.response?.status ?? error.code}`
          : 'unknown error'
      );
    }

    const parsed = productSnapshotSchema.safeParse(data);

    if (!parsed.success) {
      throw this.unavailable('unexpected product shape');
    }

    metrics.products_client_requests.add(1, { outcome: 'found' });

    return parsed.data;
  }

  private unavailable(reason: string): ServiceUnavailableException {
    metrics.products_client_requests.add(1, { outcome: 'unavailable' });
    this.logger.error(`Product lookup failed: ${reason}`);

    return new ServiceUnavailableException('Products service is unavailable');
  }
}
