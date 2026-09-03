import { IsString } from 'class-validator';

export class LinkGoogleDto {
  // The ID token returned by Google Identity Services on the frontend.
  @IsString()
  idToken: string;
}
