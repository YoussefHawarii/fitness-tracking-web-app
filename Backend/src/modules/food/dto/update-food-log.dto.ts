import { MealCategory } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsPositive,
  ValidateIf,
} from 'class-validator';
import { IsConsumedAmount } from './food-log-input.validators';

export class UpdateFoodLogDto {
  @IsOptional()
  @IsPositive()
  grams?: number;

  // Accepted so an independently deployed client receives the explicit ML
  // edit guard instead of a generic non-whitelisted-field response.
  @ValidateIf((_object, value) => value !== undefined)
  @IsConsumedAmount()
  amount?: number;

  @IsOptional()
  @IsIn(['G', 'ML'])
  amountUnit?: 'G' | 'ML';

  @IsOptional()
  @IsEnum(MealCategory)
  mealCategory?: MealCategory;
}
