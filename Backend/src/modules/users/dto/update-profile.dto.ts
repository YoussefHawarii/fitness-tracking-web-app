import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  age?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  heightCm?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  currentWeightKg?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  goalWeightKg?: number;

  @IsOptional()
  @IsIn(['LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE'])
  activityLevel?: 'LIGHTLY_ACTIVE' | 'MODERATELY_ACTIVE' | 'VERY_ACTIVE';
}
