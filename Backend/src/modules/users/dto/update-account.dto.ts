import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateAccountDto {
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @Length(1, 50)
  displayName: string;
}
