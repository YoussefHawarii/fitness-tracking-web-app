import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchFoodTranscriptQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  transcript: string;
}
