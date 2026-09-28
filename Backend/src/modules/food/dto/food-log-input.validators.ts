import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import {
  validateConsumedAmount,
  validatePortionMultiplier,
} from '../consumed-amount-validation';
import { FOOD_LOG_REJECTION_REASONS } from '../food-log-rejection-reasons';

type CreateShape = {
  grams?: unknown;
  amount?: unknown;
  amountUnit?: unknown;
  portionKind?: unknown;
  portionMultiplier?: unknown;
};

function validatorMessage(
  validator: (value: unknown) => ReturnType<typeof validateConsumedAmount>,
  value: unknown,
): string {
  const result = validator(value);
  return result.ok ? '' : result.reason;
}

export function IsConsumedAmount(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isConsumedAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return validateConsumedAmount(value).ok;
        },
        defaultMessage(args: ValidationArguments) {
          return validatorMessage(validateConsumedAmount, args.value);
        },
      },
    });
  };
}

export function IsPortionMultiplier(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPortionMultiplier',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return validatePortionMultiplier(value).ok;
        },
        defaultMessage(args: ValidationArguments) {
          return validatorMessage(validatePortionMultiplier, args.value);
        },
      },
    });
  };
}

export function HasValidFoodLogCreateShape(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'hasValidFoodLogCreateShape',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const dto = args.object as CreateShape;
          const hasGrams = dto.grams !== undefined;
          const hasAmount = dto.amount !== undefined;
          if (hasGrams === hasAmount) return false;
          if (hasAmount && dto.amountUnit === undefined) return false;
          if (!hasAmount && dto.amountUnit !== undefined) return false;
          if (
            hasGrams &&
            (dto.portionKind !== undefined ||
              dto.portionMultiplier !== undefined)
          ) {
            return false;
          }
          if (
            (dto.portionKind === 'PACKAGE' || dto.portionKind === 'SERVING') &&
            dto.portionMultiplier === undefined
          ) {
            return false;
          }
          if (
            dto.portionKind === 'CUSTOM' &&
            dto.portionMultiplier !== undefined
          ) {
            return false;
          }
          if (
            dto.portionKind === undefined &&
            dto.portionMultiplier !== undefined
          ) {
            return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const dto = args.object as CreateShape;
          const hasGrams = dto.grams !== undefined;
          const hasAmount = dto.amount !== undefined;
          if (hasGrams === hasAmount) {
            return FOOD_LOG_REJECTION_REASONS.EXACTLY_ONE_AMOUNT_REPRESENTATION_REQUIRED;
          }
          if (hasAmount && dto.amountUnit === undefined) {
            return FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_REQUIRED;
          }
          if (!hasAmount && dto.amountUnit !== undefined) {
            return FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_WITHOUT_AMOUNT;
          }
          if (
            hasGrams &&
            (dto.portionKind !== undefined ||
              dto.portionMultiplier !== undefined)
          ) {
            return FOOD_LOG_REJECTION_REASONS.LEGACY_GRAMS_PORTION_FIELDS_FORBIDDEN;
          }
          if (
            (dto.portionKind === 'PACKAGE' || dto.portionKind === 'SERVING') &&
            dto.portionMultiplier === undefined
          ) {
            return FOOD_LOG_REJECTION_REASONS.PORTION_MULTIPLIER_REQUIRED;
          }
          if (
            dto.portionKind === 'CUSTOM' &&
            dto.portionMultiplier !== undefined
          ) {
            return FOOD_LOG_REJECTION_REASONS.PORTION_MULTIPLIER_FORBIDDEN;
          }
          return FOOD_LOG_REJECTION_REASONS.PORTION_MULTIPLIER_WITHOUT_PORTION_KIND;
        },
      },
    });
  };
}
