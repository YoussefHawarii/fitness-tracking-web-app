import { MuscleGroup } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { CreateWorkoutExerciseDto } from './create-workout-exercise.dto';

export class CreateWorkoutSessionDto {
  @IsDateString()
  date: string; // YYYY-MM-DD, in the user's local timezone

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(MuscleGroup, { each: true })
  muscleGroups: MuscleGroup[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutExerciseDto)
  exercises: CreateWorkoutExerciseDto[];
}
