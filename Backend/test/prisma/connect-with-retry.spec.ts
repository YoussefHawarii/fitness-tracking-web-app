import { connectWithRetry } from '../../src/prisma/connect-with-retry';

describe('connectWithRetry', () => {
  it('succeeds immediately without sleeping', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await connectWithRetry(connect, { sleep });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('recovers after transient failures', async () => {
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await connectWithRetry(connect, { sleep, random: () => 0.5 });

    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting attempts and sleeps only between attempts', async () => {
    const errors = [new Error('first'), new Error('second'), new Error('last')];
    const connect = jest
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2]);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      connectWithRetry(connect, { attempts: 3, sleep, random: () => 0.5 }),
    ).rejects.toBe(errors[2]);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('uses exponential equal jitter with a per-delay cap', async () => {
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockRejectedValueOnce(new Error('4'))
      .mockResolvedValue(undefined);
    const delays: number[] = [];
    const sleep = (delay: number) => {
      delays.push(delay);
      return Promise.resolve();
    };

    await connectWithRetry(connect, {
      attempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 2500,
      sleep,
      random: () => 0.75,
    });

    expect(delays).toEqual([875, 1750, 2187, 2187]);
  });

  it('warns once per failed attempt with attempt, error, and next delay', async () => {
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('pooler unavailable'))
      .mockRejectedValueOnce(new Error('secret check timed out'));
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };

    await expect(
      connectWithRetry(connect, {
        attempts: 2,
        sleep: () => Promise.resolve(),
        random: () => 0.5,
        logger: { warn },
      }),
    ).rejects.toThrow('secret check timed out');

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('1/2');
    expect(warnings[0]).toContain('pooler unavailable');
    expect(warnings[0]).toContain('750 ms');
    expect(warnings[1]).toContain('2/2');
    expect(warnings[1]).toContain('secret check timed out');
    expect(warnings[1]).toContain('no retry');
  });
});
