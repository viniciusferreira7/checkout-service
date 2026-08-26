import { ConfigModule } from '@nestjs/config';
import {
  Test,
  type TestingModule,
  type TestingModuleBuilder,
} from '@nestjs/testing';
import { envSchema } from '@/env/env';
import { EnvModule } from '@/env/env.module';
import { EventsModule } from '@/events/events.module';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { FakeRabbitmqService } from '../events/fake-rabbitmq-service';

export async function makeEventsModuleRef(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder
): Promise<TestingModule> {
  let builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: ['.env.test', '.env'],
        validate: (env) => envSchema.parse(env),
      }),
      EnvModule,
      EventsModule,
    ],
  })
    .overrideProvider(RabbitmqService)
    .useClass(FakeRabbitmqService);

  if (configure) {
    builder = configure(builder);
  }

  return builder.compile();
}
