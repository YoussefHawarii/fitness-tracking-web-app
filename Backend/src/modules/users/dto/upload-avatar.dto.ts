import { IsString, IsUrl, MinLength } from 'class-validator';

export class UploadAvatarDto {
  @IsUrl()
  url: string;

  @IsString()
  @MinLength(1)
  publicId: string;
}
