import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckoutDto } from './checkout.dto';

async function invalidPropertiesOf(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CheckoutDto, body), {
    whitelist: true,
  });

  return errors.map((error) => error.property);
}

describe('CheckoutDto', () => {
  it.each(['credit_card', 'debit_card', 'pix', 'boleto'])(
    'accepts %s',
    async (paymentMethod) => {
      await expect(invalidPropertiesOf({ paymentMethod })).resolves.toEqual([]);
    }
  );

  it.each([
    ['missing', {}],
    ['unknown', { paymentMethod: 'crypto' }],
    ['in another case', { paymentMethod: 'PIX' }],
    ['not a string', { paymentMethod: 1 }],
  ])('rejects a payment method that is %s', async (_case, body) => {
    await expect(invalidPropertiesOf(body)).resolves.toEqual(['paymentMethod']);
  });
});
