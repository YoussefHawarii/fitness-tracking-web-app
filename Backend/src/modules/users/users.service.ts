import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { calculateBaseline } from './baseline-calculator';
import {
  calculateGoalDirection,
  calculateDailyCalorieTarget,
} from './goal-direction';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { CloudinaryService } from './cloudinary.service';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly authService: AuthService,
  ) {}

  // Goal direction and Daily calorie target are derived, never stored
  // (CONTEXT.md "Goal direction" / "Daily calorie target") — computed fresh
  // on every response rather than persisted alongside the baseline.
  private withGoalDirection<
    T extends {
      currentWeightKg: unknown;
      goalWeightKg: unknown;
      tdee: unknown;
    },
  >(baseline: T) {
    const goalDirection = calculateGoalDirection(
      Number(baseline.currentWeightKg),
      Number(baseline.goalWeightKg),
    );
    return {
      ...baseline,
      goalDirection,
      dailyCalorieTarget: calculateDailyCalorieTarget(
        Number(baseline.tdee),
        goalDirection,
      ),
    };
  }

  async createBaseline(userId: string, dto: OnboardingDto) {
    const { bmr, tdee } = calculateBaseline({
      sex: dto.sex,
      weightKg: dto.currentWeightKg,
      heightCm: dto.heightCm,
      age: dto.age,
      activityLevel: dto.activityLevel,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { timezone: dto.timezone },
    });

    const baseline = await this.prisma.userBaseline.upsert({
      where: { userId },
      create: {
        userId,
        age: dto.age,
        sex: dto.sex,
        heightCm: dto.heightCm,
        currentWeightKg: dto.currentWeightKg,
        goalWeightKg: dto.goalWeightKg,
        activityLevel: dto.activityLevel,
        bmr,
        tdee,
      },
      update: {
        age: dto.age,
        sex: dto.sex,
        heightCm: dto.heightCm,
        currentWeightKg: dto.currentWeightKg,
        goalWeightKg: dto.goalWeightKg,
        activityLevel: dto.activityLevel,
        bmr,
        tdee,
      },
    });

    return this.withGoalDirection(baseline);
  }

  // Composed view for the Account/Settings page (specs/008-sidebar-profile-account)
  // — never returns the password hash, Google subject id, or Cloudinary
  // public id, only booleans/URLs derived from them.
  async getAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return {
      displayName: user.displayName ?? user.username ?? user.email,
      avatarUrl: user.avatarUrl,
      unitsPreference: user.unitsPreference,
      languagePreference: user.languagePreference,
      appearancePreference: user.appearancePreference,
      hasPassword: user.passwordHash !== null,
      googleLinked: user.googleSubjectId !== null,
    };
  }

  async updateDisplayName(userId: string, dto: UpdateAccountDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: dto.displayName },
    });
    return this.getAccount(userId);
  }

  getAvatarUploadSignature(userId: string) {
    return this.cloudinaryService.createUploadSignature(userId);
  }

  async confirmAvatarUpload(userId: string, dto: UploadAvatarDto) {
    await this.cloudinaryService.verifyUpload(userId, dto.publicId);

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPublicId: true },
    });
    if (existing?.avatarPublicId) {
      await this.cloudinaryService.destroyAsset(existing.avatarPublicId);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: dto.url, avatarPublicId: dto.publicId },
    });
    return { avatarUrl: dto.url };
  }

  async removeAvatar(userId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPublicId: true },
    });
    if (existing?.avatarPublicId) {
      await this.cloudinaryService.destroyAsset(existing.avatarPublicId);
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: null, avatarPublicId: null },
      });
    }
    return { avatarUrl: null };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'This account has no password set yet — set one instead of changing it.',
      );
    }
    const currentMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    // A stolen refresh token must not survive a password change.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async setPassword(userId: string, dto: SetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.passwordHash) {
      throw new ConflictException(
        'This account already has a password — use change password instead.',
      );
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async linkGoogleAccount(userId: string, idToken: string) {
    const { subjectId } = await this.authService.verifyGoogleIdToken(idToken);

    const existingOwner = await this.prisma.user.findUnique({
      where: { googleSubjectId: subjectId },
    });
    if (existingOwner && existingOwner.id !== userId) {
      throw new ConflictException(
        'This Google account is already linked to a different account.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { googleSubjectId: subjectId },
    });
    return { googleLinked: true };
  }

  async unlinkGoogleAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (!user.passwordHash) {
      throw new ConflictException(
        'Set a password before unlinking Google — this is your only way to sign in.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { googleSubjectId: null },
    });
    return { googleLinked: false };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.unitsPreference !== undefined && {
          unitsPreference: dto.unitsPreference,
        }),
        ...(dto.languagePreference !== undefined && {
          languagePreference: dto.languagePreference,
        }),
        ...(dto.appearancePreference !== undefined && {
          appearancePreference: dto.appearancePreference,
        }),
      },
    });
    return this.getAccount(userId);
  }

  async getGoals(userId: string) {
    const baseline = await this.prisma.userBaseline.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!baseline) {
      throw new NotFoundException(
        'No baseline found — complete onboarding first.',
      );
    }
    const { user, ...rest } = baseline;
    return this.withGoalDirection({ ...rest, timezone: user.timezone });
  }

  // Recalculates BMR/TDEE whenever age/height/weight/activity change (FR-006) —
  // never just at signup.
  async updateGoals(userId: string, dto: UpdateProfileDto) {
    const existing = await this.getGoals(userId);

    const merged = {
      age: dto.age ?? existing.age,
      sex: existing.sex,
      heightCm: dto.heightCm ?? Number(existing.heightCm),
      currentWeightKg: dto.currentWeightKg ?? Number(existing.currentWeightKg),
      goalWeightKg: dto.goalWeightKg ?? Number(existing.goalWeightKg),
      activityLevel: dto.activityLevel ?? existing.activityLevel,
    };

    const { bmr, tdee } = calculateBaseline({
      sex: merged.sex,
      weightKg: merged.currentWeightKg,
      heightCm: merged.heightCm,
      age: merged.age,
      activityLevel: merged.activityLevel,
    });

    const updated = await this.prisma.userBaseline.update({
      where: { userId },
      data: { ...merged, bmr, tdee },
    });

    return this.withGoalDirection(updated);
  }
}
