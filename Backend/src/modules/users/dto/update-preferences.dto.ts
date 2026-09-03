import { Appearance, Units } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsEnum(Units)
  unitsPreference?: Units;

  @IsOptional()
  @IsString()
  @MinLength(1)
  languagePreference?: string;

  @IsOptional()
  @IsEnum(Appearance)
  appearancePreference?: Appearance;
}
