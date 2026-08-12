import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { PaymentQueueService } from './payment-queue.service';

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;

  beforeEach(async () => {
    // `PaymentQueueService` injects `RabbitmqService` and `EnvService`, so the
    // container needs both to resolve. Both are stubbed, so nothing here talks
    // to a broker or reads the real environment.
    const rabbitMqService = {
      publicMessage: vi.fn().mockResolvedValue(undefined),
    };

    const envService = {
      get: vi.fn().mockReturnValue('value'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentQueueService,
        { provide: RabbitmqService, useValue: rabbitMqService },
        { provide: EnvService, useValue: envService },
      ],
    }).compile();

    service = module.get<PaymentQueueService>(PaymentQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
