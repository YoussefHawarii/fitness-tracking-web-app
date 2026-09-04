import {
  IsIn,
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class OnboardingDto {
  @IsInt()
  @Min(1)
  age: number;

  @IsIn(['MALE', 'FEMALE'])
  sex: 'MALE' | 'FEMALE';

  @IsNumber()
  @IsPositive()
  heightCm: number;

  @IsNumber()
  @IsPositive()
  currentWeightKg: number;

  @IsNumber()
  @IsPositive()
  goalWeightKg: number;

  @IsIn(['LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE'])
  activityLevel: 'LIGHTLY_ACTIVE' | 'MODERATELY_ACTIVE' | 'VERY_ACTIVE';

  @IsString()
  timezone: string;
}
