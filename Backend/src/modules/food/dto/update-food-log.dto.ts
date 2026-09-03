import { MealCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsPositive } from 'class-validator';

export class UpdateFoodLogDto {
  @IsOptional()
  @IsPositive()
  grams?: number;

  @IsOptional()
  @IsEnum(MealCategory)
  mealCategory?: MealCategory;
}
