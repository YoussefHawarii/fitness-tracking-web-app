import { IsDateString, IsNumber, IsPositive } from 'class-validator';

export class CreateWeighInDto {
  @IsNumber()
  @IsPositive()
  weightKg: number;

  @IsDateString()
  date: string; // YYYY-MM-DD, in the user's local timezone
}
