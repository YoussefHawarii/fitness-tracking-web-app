import { MealCategory } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, ValidateIf } from 'class-validator';
import {
  HasValidFoodLogUpdateShape,
  IsConsumedAmount,
  IsPortionMultiplier,
} from './food-log-input.validators';
import { FOOD_LOG_REJECTION_REASONS } from '../food-log-rejection-reasons';
import type {
  FoodLogAmountUnit,
  FoodLogPortionKind,
} from './create-food-log.dto';

export class UpdateFoodLogDto {
  @HasValidFoodLogUpdateShape()
  @IsConsumedAmount()
  grams?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsConsumedAmount()
  amount?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['G', 'ML'], {
    message: FOOD_LOG_REJECTION_REASONS.INVALID_AMOUNT_UNIT,
  })
  amountUnit?: FoodLogAmountUnit;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['PACKAGE', 'SERVING', 'CUSTOM'], {
    message: FOOD_LOG_REJECTION_REASONS.INVALID_PORTION_KIND,
  })
  portionKind?: FoodLogPortionKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsPortionMultiplier()
  portionMultiplier?: number;

  @IsOptional()
  @IsEnum(MealCategory)
  mealCategory?: MealCategory;
}
