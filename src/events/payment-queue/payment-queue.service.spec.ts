import { Test, TestingModule } from '@nestjs/testing';
import { PaymentQueueService } from './payment-queue.service';

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentQueueService],
    }).compile();

    service = module.get<PaymentQueueService>(PaymentQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
