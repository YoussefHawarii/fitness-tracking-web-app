import { SportType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateExerciseLogDto {
  @IsOptional()
  @IsEnum(SportType)
  sportType?: SportType;

  @ValidateIf((dto: UpdateExerciseLogDto) => dto.sportType === SportType.OTHER)
  @IsString()
  @MinLength(1)
  customSportName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;
}
