import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { SupportController } from './support.controller';

// No AuthModule import needed: JwtAuthGuard only needs the 'jwt' Passport
// strategy, which is already registered globally via AppModule's own import
// of AuthModule elsewhere — importing AuthModule here would create a cycle
// (AuthModule already imports MailModule for OTP/welcome email sending).
@Module({
  imports: [ConfigModule],
  controllers: [SupportController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
