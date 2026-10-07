import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddCartItemDto } from './add-cart-item.dto';

const PRODUCT_ID = '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f';

async function invalidPropertiesOf(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(AddCartItemDto, body), {
    whitelist: true,
  });

  return errors.map((error) => error.property);
}

describe('AddCartItemDto', () => {
  it('accepts a product and a quantity', async () => {
    await expect(
      invalidPropertiesOf({ productId: PRODUCT_ID, quantity: 1 })
    ).resolves.toEqual([]);
  });

  it.each([
    ['productId', 'missing', { quantity: 1 }],
    ['productId', 'not a uuid', { productId: 'kbd-1', quantity: 1 }],
    ['quantity', 'missing', { productId: PRODUCT_ID }],
    ['quantity', 'zero', { productId: PRODUCT_ID, quantity: 0 }],
    ['quantity', 'a decimal', { productId: PRODUCT_ID, quantity: 1.5 }],
    ['quantity', 'a numeric string', { productId: PRODUCT_ID, quantity: '2' }],
    ['quantity', 'over 99', { productId: PRODUCT_ID, quantity: 100 }],
  ])('rejects %s when it is %s', async (property, _case, body) => {
    await expect(invalidPropertiesOf(body)).resolves.toEqual([property]);
  });
});
