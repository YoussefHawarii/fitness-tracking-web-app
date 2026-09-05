import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { globalValidationPipe } from './common/pipes/validation.pipe';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Frontend runs on a separate origin (Vercel) from the API (Railway),
  // so CORS must be enabled explicitly rather than left to same-origin defaults.
  app.enableCors({
    origin: configService.get<string>(
      'FRONTEND_ORIGIN',
      'http://localhost:5173',
    ),
    credentials: true,
  });

  app.useGlobalPipes(globalValidationPipe);
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
