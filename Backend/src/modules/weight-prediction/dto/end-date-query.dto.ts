import { IsDateString } from 'class-validator';

export class EndDateQueryDto {
  @IsDateString()
  endDate: string; // YYYY-MM-DD, in the user's account timezone
}
