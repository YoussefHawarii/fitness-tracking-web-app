import { WorkoutExerciseType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { CreateWorkoutSetDto } from './create-workout-set.dto';

export class CreateWorkoutExerciseDto {
  @IsEnum(WorkoutExerciseType)
  exerciseType: WorkoutExerciseType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutSetDto)
  sets: CreateWorkoutSetDto[];
}
