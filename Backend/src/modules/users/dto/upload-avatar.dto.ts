import { IsString, IsUrl, MinLength } from 'class-validator';

export class UploadAvatarDto {
  // Accepted for backward-compatible request shape only — the server never
  // persists this value. It re-derives the real URL from Cloudinary's own
  // verified resource for the given publicId instead of trusting the client.
  @IsUrl()
  url: string;

  @IsString()
  @MinLength(1)
  publicId: string;
}
