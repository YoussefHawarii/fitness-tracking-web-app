import { PrismaService } from '../../src/prisma/prisma.service';
import { connectWithRetry } from '../../src/prisma/connect-with-retry';

jest.mock('../../src/prisma/connect-with-retry', () => ({
  connectWithRetry: jest.fn().mockResolvedValue(undefined),
}));

describe('PrismaService', () => {
  it('uses the retry helper during module initialization', async () => {
    const service = new PrismaService();
    const connect = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connectWithRetry).toHaveBeenCalledTimes(1);
    const retryConnect = jest.mocked(connectWithRetry).mock.calls[0][0];
    await retryConnect();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
