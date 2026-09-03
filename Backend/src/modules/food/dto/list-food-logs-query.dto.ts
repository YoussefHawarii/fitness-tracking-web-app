import { IsDateString } from 'class-validator';

export class ListFoodLogsQueryDto {
  @IsDateString()
  date: string; // YYYY-MM-DD, in the user's account timezone
}
