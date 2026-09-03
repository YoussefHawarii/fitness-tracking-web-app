import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export interface AvatarUploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  uploadUrl: string;
}

// Signed direct-to-Cloudinary avatar upload (specs/008-sidebar-profile-account/research.md §1).
@Injectable()
export class CloudinaryService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.cloudName = this.configService.get<string>(
      'CLOUDINARY_CLOUD_NAME',
      '',
    );
    this.apiKey = this.configService.get<string>('CLOUDINARY_API_KEY', '');
    this.apiSecret = this.configService.get<string>(
      'CLOUDINARY_API_SECRET',
      '',
    );
    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
    });
  }

  private folderFor(userId: string): string {
    return `avatars/u_${userId}`;
  }

  createUploadSignature(userId: string): AvatarUploadSignature {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = this.folderFor(userId);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      this.apiSecret,
    );

    return {
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      timestamp,
      signature,
      folder,
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`,
    };
  }

  // Confirms the given asset actually exists and was uploaded to this
  // user's own signed folder — never trust a client-supplied publicId/url
  // pair blindly (data-model.md's avatarUrl/avatarPublicId validation rule).
  async verifyUpload(userId: string, publicId: string): Promise<void> {
    const expectedFolder = this.folderFor(userId);
    if (!publicId.startsWith(`${expectedFolder}/`)) {
      throw new BadRequestException(
        'Uploaded asset does not belong to this account.',
      );
    }
    try {
      await cloudinary.api.resource(publicId);
    } catch {
      throw new BadRequestException('Could not verify the uploaded asset.');
    }
  }

  async destroyAsset(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
