import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { MailService } from './mail.service';
import { FeedbackDto } from './dto/feedback.dto';

@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly mailService: MailService) {}

  @Post('feedback')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: FeedbackDto,
  ) {
    await this.mailService.sendFeedbackEmail(
      user.email,
      dto.subject,
      dto.message,
    );
    return { received: true };
  }
}
