interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: { warn: (message: string) => void };
}

export async function connectWithRetry(
  connect: () => Promise<void>,
  options: RetryOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 8;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const logger = options.logger ?? console;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await connect();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts) {
        logger.warn(
          `Database connect failed (${attempt}/${attempts}): ${message}; no retry`,
        );
        throw error;
      }
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(ceiling / 2 + random() * (ceiling / 2));
      logger.warn(
        `Database connect failed (${attempt}/${attempts}): ${message}; next delay ${delay} ms`,
      );
      await sleep(delay);
    }
  }
}
