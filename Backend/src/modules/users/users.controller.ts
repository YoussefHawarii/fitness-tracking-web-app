import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { LinkGoogleDto } from './dto/link-google.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('onboarding')
  onboard(@CurrentUser() user: AuthenticatedUser, @Body() dto: OnboardingDto) {
    return this.usersService.createBaseline(user.userId, dto);
  }

  @Get('profile/account')
  getAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getAccount(user.userId);
  }

  @Patch('profile/account')
  updateDisplayName(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.usersService.updateDisplayName(user.userId, dto);
  }

  @Post('profile/avatar/upload-signature')
  getAvatarUploadSignature(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getAvatarUploadSignature(user.userId);
  }

  @Patch('profile/avatar')
  confirmAvatarUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadAvatarDto,
  ) {
    return this.usersService.confirmAvatarUpload(user.userId, dto);
  }

  @Delete('profile/avatar')
  removeAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.removeAvatar(user.userId);
  }

  @Patch('profile/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(user.userId, dto);
  }

  @Post('profile/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPasswordDto,
  ) {
    return this.usersService.setPassword(user.userId, dto);
  }

  @Post('profile/google/link')
  linkGoogleAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkGoogleDto,
  ) {
    return this.usersService.linkGoogleAccount(user.userId, dto.idToken);
  }

  @Delete('profile/google/link')
  unlinkGoogleAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.unlinkGoogleAccount(user.userId);
  }

  @Patch('profile/preferences')
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(user.userId, dto);
  }

  @Get('goals')
  getGoals(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getGoals(user.userId);
  }

  @Patch('goals')
  updateGoals(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateGoals(user.userId, dto);
  }
}
