import { IsString } from 'class-validator';

export class GoogleLoginDto {
  // The ID token returned by Google Identity Services on the frontend.
  @IsString()
  idToken: string;

  @IsString()
  timezone: string;
}
