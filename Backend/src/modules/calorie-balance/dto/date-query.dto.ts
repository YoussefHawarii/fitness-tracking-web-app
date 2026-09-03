import { IsDateString } from 'class-validator';

export class DateQueryDto {
  @IsDateString()
  date: string; // YYYY-MM-DD, in the user's account timezone
}
