import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  FOOD_LOG_REJECTION_MESSAGES,
  isFoodLogRejectionReason,
} from '../../modules/food/food-log-rejection-reasons';

function findFoodLogReason(errors: ValidationError[]): string | undefined {
  for (const error of errors) {
    for (const message of Object.values(error.constraints ?? {})) {
      if (isFoodLogRejectionReason(message)) return message;
    }
    const nested = findFoodLogReason(error.children ?? []);
    if (nested) return nested;
  }
  return undefined;
}

function validationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...validationMessages(error.children ?? []),
  ]);
}

// Centralized validation pipe config: strips unknown properties, rejects
// requests carrying properties that aren't part of the DTO, and type-coerces
// primitives from the wire format (query/params are always strings).
export const globalValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) => {
    const reason = findFoodLogReason(errors);
    if (reason && isFoodLogRejectionReason(reason)) {
      return new BadRequestException({
        message: FOOD_LOG_REJECTION_MESSAGES[reason],
        reason,
      });
    }
    return new BadRequestException(validationMessages(errors));
  },
});
