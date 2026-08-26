import type { EnvService } from '../env/env.service';
import { databaseConfig } from './database.config';

const DATABASE_URL = 'postgres://test:test@localhost:5432/checkout_test';

function makeEnvService(nodeEnv: 'dev' | 'test' | 'production') {
  const values: Record<string, unknown> = {
    NODE_ENV: nodeEnv,
    DATABASE_URL,
  };

  return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

describe('databaseConfig', () => {
  it('builds a postgres connection from the validated environment', () => {
    const config = databaseConfig(makeEnvService('dev'));

    expect(config).toMatchObject({
      type: 'postgres',
      url: DATABASE_URL,
      autoLoadEntities: true,
    });
  });

  it('synchronises the schema only in dev', () => {
    expect(databaseConfig(makeEnvService('dev'))).toMatchObject({
      synchronize: true,
    });
    expect(databaseConfig(makeEnvService('test'))).toMatchObject({
      synchronize: false,
    });
    expect(databaseConfig(makeEnvService('production'))).toMatchObject({
      synchronize: false,
    });
  });

  it('disables query logging in production', () => {
    expect(databaseConfig(makeEnvService('production'))).toMatchObject({
      logging: false,
    });
    expect(databaseConfig(makeEnvService('dev'))).toMatchObject({
      logging: true,
    });
    expect(databaseConfig(makeEnvService('test'))).toMatchObject({
      logging: true,
    });
  });

  it('does not read process.env directly', () => {
    const env = makeEnvService('dev');

    databaseConfig(env);

    expect(env.get).toHaveBeenCalledWith('DATABASE_URL');
    expect(env.get).toHaveBeenCalledWith('NODE_ENV');
  });
});
