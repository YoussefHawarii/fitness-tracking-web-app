import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

// Packaged products carry a full nutrition-facts panel by convention (and by
// Egyptian labeling requirements), unlike a private LocalFoodItem — so
// calories/protein/carbs/fat are required here even though
// CreateLocalFoodItemDto leaves macros optional. Brand/serving/package
// details stay optional to match the schema's nullability (a generic/
// unbranded item is still a valid submission).
export class CreatePackagedProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  barcode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  servingSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  servingUnit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  packageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  packageUnit?: string;

  @IsNumber()
  @Min(0)
  caloriesPer100g: number;

  @IsNumber()
  @Min(0)
  proteinPer100g: number;

  @IsNumber()
  @Min(0)
  carbsPer100g: number;

  @IsNumber()
  @Min(0)
  fatPer100g: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fiberPer100g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sugarPer100g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sodiumPer100g?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
}
