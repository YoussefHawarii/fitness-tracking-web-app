import { SportType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateExerciseLogDto {
  @IsEnum(SportType)
  sportType: SportType;

  @ValidateIf((dto: CreateExerciseLogDto) => dto.sportType === SportType.OTHER)
  @IsString()
  @MinLength(1)
  customSportName?: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes: number;

  @IsDateString()
  date: string; // YYYY-MM-DD, in the user's local timezone
}
