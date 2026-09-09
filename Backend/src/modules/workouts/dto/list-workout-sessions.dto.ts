import { MuscleGroup } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListWorkoutSessionsDto {
  @IsOptional()
  @IsEnum(MuscleGroup)
  muscleGroup?: MuscleGroup;
}
