import { ValidationPipe } from '@nestjs/common';

// Centralized validation pipe config: strips unknown properties, rejects
// requests carrying properties that aren't part of the DTO, and type-coerces
// primitives from the wire format (query/params are always strings).
export const globalValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
