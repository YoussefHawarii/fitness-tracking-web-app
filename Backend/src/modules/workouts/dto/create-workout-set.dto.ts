import { IsInt, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

export class CreateWorkoutSetDto {
  @IsInt()
  @Min(1)
  reps: number;

  // Omitted entirely for a Bodyweight set — never 0 (see CONTEXT.md).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  weightKg?: number;
}
