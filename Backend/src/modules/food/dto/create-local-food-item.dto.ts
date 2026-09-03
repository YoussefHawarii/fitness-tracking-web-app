import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateLocalFoodItemDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  caloriesPer100g: number;

  @IsOptional()
  @IsNumber()
  proteinPer100g?: number;

  @IsOptional()
  @IsNumber()
  carbsPer100g?: number;

  @IsOptional()
  @IsNumber()
  fatPer100g?: number;
}
