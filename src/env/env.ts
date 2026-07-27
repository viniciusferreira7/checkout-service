import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['dev', 'test', 'production']).default('dev'),
  PORT: z.coerce.number().default(3334),

  DATABASE_URL: z.url(),

  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().min(2),

  RABBITMQ_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;
