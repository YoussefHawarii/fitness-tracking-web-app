import { IsString, MinLength } from 'class-validator';

export class SearchFoodQueryDto {
  @IsString()
  @MinLength(1)
  term: string;
}
