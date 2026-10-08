import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { globalValidationPipe } from './common/pipes/validation.pipe';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { corsOptionsFromEnv } from './common/cors/cors-options';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Frontend and API are separate Vercel projects on different origins,
  // so CORS must be enabled explicitly rather than left to same-origin defaults.
  // On Vercel this file is the auto-detected NestJS entrypoint and runs as a
  // single Vercel Function; app.listen() is still how it receives requests.
  app.enableCors(
    corsOptionsFromEnv(configService.get<string>('FRONTEND_ORIGIN')),
  );

  app.useGlobalPipes(globalValidationPipe);
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
