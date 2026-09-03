import { IsString, Length } from 'class-validator';

export class FeedbackDto {
  @IsString()
  @Length(1, 120)
  subject: string;

  @IsString()
  @Length(1, 2000)
  message: string;
}
