import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { corsOptionsFromEnv } from '../../src/common/cors/cors-options';

// Exercised through a real Nest app and the same app.enableCors() call that
// main.ts makes, so "allowed"/"rejected" is decided by the actual CORS
// middleware rather than re-implemented here.

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return 'ok';
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

const PROD = 'https://fitness-tracking-web-app.vercel.app';
const PREVIEW =
  'https://fitness-tracking-web-app-git-fe-4d7ac3-youssefhawariis-projects.vercel.app';
const ATTACKER = 'https://evil.example';

async function appWith(frontendOrigin: string | undefined) {
  const app = await NestFactory.create<INestApplication<App>>(PingModule, {
    logger: false,
  });
  app.enableCors(corsOptionsFromEnv(frontendOrigin));
  await app.init();
  return app;
}

function allowOrigin(app: INestApplication<App>, origin?: string) {
  const req = request(app.getHttpServer()).get('/ping');
  return (origin ? req.set('Origin', origin) : req).then((res) => ({
    status: res.status,
    allowOrigin: res.headers['access-control-allow-origin'],
    allowCredentials: res.headers['access-control-allow-credentials'],
  }));
}

describe('corsOptionsFromEnv', () => {
  let app: INestApplication<App> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('keeps a single configured origin working exactly as before, with credentials', async () => {
    app = await appWith(PROD);

    expect(await allowOrigin(app, PROD)).toEqual({
      status: 200,
      allowOrigin: PROD,
      allowCredentials: 'true',
    });
  });

  it('allows every origin in a comma-separated list', async () => {
    app = await appWith(`${PROD},${PREVIEW}`);

    expect((await allowOrigin(app, PROD)).allowOrigin).toBe(PROD);
    expect(await allowOrigin(app, PREVIEW)).toEqual({
      status: 200,
      allowOrigin: PREVIEW,
      allowCredentials: 'true',
    });
  });

  it('trims whitespace around each listed origin', async () => {
    app = await appWith(`  ${PROD} ,\t${PREVIEW}  `);

    expect((await allowOrigin(app, PROD)).allowOrigin).toBe(PROD);
    expect((await allowOrigin(app, PREVIEW)).allowOrigin).toBe(PREVIEW);
  });

  it('ignores empty entries instead of treating them as an allowed origin', () => {
    expect(corsOptionsFromEnv(`,${PROD},, ,`).origin).toBe(PROD);
    expect(corsOptionsFromEnv(` ,${PROD},,${PREVIEW},`).origin).toEqual([
      PROD,
      PREVIEW,
    ]);
  });

  it('never grants an unlisted origin, with one or several origins configured', async () => {
    app = await appWith(PROD);
    expect((await allowOrigin(app, ATTACKER)).allowOrigin).not.toBe(ATTACKER);
    await app.close();

    app = await appWith(`${PROD},${PREVIEW}`);
    const res = await allowOrigin(app, ATTACKER);
    expect(res.allowOrigin).toBeUndefined();
  });

  it('still serves requests that carry no Origin header (curl, health checks)', async () => {
    app = await appWith(`${PROD},${PREVIEW}`);

    const res = await allowOrigin(app);
    expect(res.status).toBe(200);
    expect(res.allowOrigin).toBeUndefined();
  });

  it('falls back to the local Vite dev server when FRONTEND_ORIGIN is only blanks and commas', () => {
    expect(corsOptionsFromEnv(' , ').origin).toBe('http://localhost:5173');
  });

  it('falls back to the local Vite dev server when FRONTEND_ORIGIN is unset', async () => {
    app = await appWith(undefined);

    const res = await allowOrigin(app, 'http://localhost:5173');
    expect(res.allowOrigin).toBe('http://localhost:5173');
  });
});
