import {
  IsDateString,
  IsIn,
  IsNumber,
  IsPositive,
  IsString,
} from 'class-validator';

export type FoodSourceType = 'OPEN_FOOD_FACTS' | 'USDA' | 'LOCAL';
export type MealCategory = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACKS';

export class CreateFoodLogDto {
  @IsIn(['OPEN_FOOD_FACTS', 'USDA', 'LOCAL'])
  sourceType: FoodSourceType;

  // Barcode (OFF), fdcId (USDA), or LocalFoodItem id (LOCAL)
  @IsString()
  sourceRef: string;

  @IsNumber()
  @IsPositive()
  grams: number;

  @IsIn(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'])
  mealCategory: MealCategory;

  @IsDateString()
  loggedAtUtc: string;
}
