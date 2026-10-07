import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { metrics } from '@/observability/metrics';
import { ProductsClientService } from './products-client.service';

const PRODUCT_ID = '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f';
const SELLER_ID = '0a1b2c3d-4e5f-4a1b-8c3d-4e5f6a1b2c3d';

const body = {
  id: PRODUCT_ID,
  name: 'Mechanical keyboard',
  description: 'Hot-swappable',
  price: 19.9,
  stock: 10,
  sellerId: SELLER_ID,
  isActive: true,
  createdAt: '2026-10-04T12:00:00.000Z',
  updatedAt: '2026-10-04T12:00:00.000Z',
};

function ok(data: unknown) {
  return of({ data, status: 200 } as AxiosResponse);
}

function httpError(status?: number) {
  const config = { headers: new AxiosHeaders() };

  return throwError(
    () =>
      new AxiosError(
        'request failed',
        status ? 'ERR_BAD_RESPONSE' : 'ECONNREFUSED',
        config,
        undefined,
        status
          ? ({
              status,
              data: { message: 'internal detail' },
              config,
            } as AxiosResponse)
          : undefined
      )
  );
}

describe('ProductsClientService', () => {
  const originals = { ...metrics };
  let requests: ReturnType<typeof vi.fn>;
  let http: { get: ReturnType<typeof vi.fn> };
  let client: ProductsClientService;

  beforeEach(() => {
    requests = vi.fn();
    Object.assign(metrics, { products_client_requests: { add: requests } });
    http = { get: vi.fn() };
    client = new ProductsClientService(http as never);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.assign(metrics, originals);
    vi.restoreAllMocks();
  });

  it('asks for the product by its encoded id', async () => {
    http.get.mockReturnValue(ok(body));

    await client.getProduct(PRODUCT_ID);

    expect(http.get).toHaveBeenCalledWith(`/products/${PRODUCT_ID}`);
  });

  it('answers only the fields the cart needs', async () => {
    http.get.mockReturnValue(ok(body));

    await expect(client.getProduct(PRODUCT_ID)).resolves.toEqual({
      id: PRODUCT_ID,
      name: 'Mechanical keyboard',
      price: 19.9,
      stock: 10,
      sellerId: SELLER_ID,
      isActive: true,
    });
    expect(requests).toHaveBeenCalledExactlyOnceWith(1, { outcome: 'found' });
  });

  it('answers null when the products service says 404', async () => {
    http.get.mockReturnValue(httpError(404));

    await expect(client.getProduct(PRODUCT_ID)).resolves.toBeNull();
    expect(requests).toHaveBeenCalledExactlyOnceWith(1, {
      outcome: 'not_found',
    });
  });

  it.each([
    ['a 500', () => httpError(500)],
    ['a refused connection', () => httpError()],
    ['a body without a price', () => ok({ ...body, price: undefined })],
    ['a price sent as a string', () => ok({ ...body, price: '19.90' })],
    ['a body that is not an object', () => ok('<html>')],
  ])('answers 503 to %s, never forwarding its detail', async (_case, reply) => {
    http.get.mockReturnValue(reply());

    const error = await client
      .getProduct(PRODUCT_ID)
      .catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toBe('Products service is unavailable');
    expect(requests).toHaveBeenCalledExactlyOnceWith(1, {
      outcome: 'unavailable',
    });
  });
});
