import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

// Single source of truth for this string union on the backend —
// food-search.service.ts derives its own narrower type from this rather than
// redeclaring the literal list. The frontend's foodService.ts can't import
// this directly (separate deployable, no shared package) and keeps its own
// copy in sync by hand — see the comment there.
export const FOOD_SOURCE_TYPES = [
  'OPEN_FOOD_FACTS',
  'USDA',
  'LOCAL',
  'CANONICAL',
] as const;
export type FoodSourceType = (typeof FOOD_SOURCE_TYPES)[number];
export type MealCategory = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACKS';

export class CreateFoodLogDto {
  @IsIn(FOOD_SOURCE_TYPES)
  sourceType: FoodSourceType;

  // Barcode (OFF), fdcId (USDA), LocalFoodItem id (LOCAL), or CanonicalFood id (CANONICAL)
  @IsString()
  sourceRef: string;

  // For CANONICAL only: the display name the user actually saw and picked
  // (English or Arabic, whichever their search matched) — the search
  // endpoint already resolved this; trusting it back avoids re-deciding
  // which language to show in history. Ignored for every other sourceType,
  // which resolve their own name server-side as before.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsNumber()
  @IsPositive()
  grams: number;

  @IsIn(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'])
  mealCategory: MealCategory;

  @IsDateString()
  loggedAtUtc: string;
}
