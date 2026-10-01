import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const LOCAL_VITE_DEV_SERVER = 'http://localhost:5173';

// FRONTEND_ORIGIN is one origin or a comma-separated list (production plus a
// Vercel preview, say). Only exact listed origins are ever allowed. A single
// origin is passed through as a plain string so production keeps exactly the
// CORS behaviour it had before lists were supported.
export function corsOptionsFromEnv(
  frontendOrigin: string | undefined,
): CorsOptions {
  const origins = (frontendOrigin ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    origin:
      origins.length === 0
        ? LOCAL_VITE_DEV_SERVER
        : origins.length === 1
          ? origins[0]
          : origins,
    credentials: true,
  };
}
