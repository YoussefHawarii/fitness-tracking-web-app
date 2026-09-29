import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  HasValidFoodLogCreateShape,
  IsConsumedAmount,
  IsPortionMultiplier,
} from './food-log-input.validators';
import { FOOD_LOG_REJECTION_REASONS } from '../food-log-rejection-reasons';

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
  'PACKAGED_PRODUCT',
] as const;
export type FoodSourceType = (typeof FOOD_SOURCE_TYPES)[number];
export type MealCategory = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACKS';
export type FoodLogAmountUnit = 'G' | 'ML';
export type FoodLogPortionKind = 'PACKAGE' | 'SERVING' | 'CUSTOM';

export class CreateFoodLogDto {
  @IsIn(FOOD_SOURCE_TYPES)
  @HasValidFoodLogCreateShape()
  sourceType: FoodSourceType;

  // Barcode (OFF), fdcId (USDA), LocalFoodItem id (LOCAL), CanonicalFood id
  // (CANONICAL), or PackagedProduct id (PACKAGED_PRODUCT).
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

  @IsConsumedAmount()
  amount: number;

  @IsIn(['G', 'ML'], {
    message: FOOD_LOG_REJECTION_REASONS.INVALID_AMOUNT_UNIT,
  })
  amountUnit: FoodLogAmountUnit;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['PACKAGE', 'SERVING', 'CUSTOM'], {
    message: FOOD_LOG_REJECTION_REASONS.INVALID_PORTION_KIND,
  })
  portionKind?: FoodLogPortionKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsPortionMultiplier()
  portionMultiplier?: number;

  @IsIn(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'])
  mealCategory: MealCategory;

  @IsDateString()
  loggedAtUtc: string;
}
