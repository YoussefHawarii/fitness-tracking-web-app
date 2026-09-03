import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.from = this.configService.get<string>(
      'SMTP_FROM',
      'no-reply@example.com',
    );
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<number>('SMTP_PORT', 587) === 465,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  // Sent on signup and on every resend (FR-005, FR-009, FR-010). Always
  // states the 5-minute expiry so the user isn't surprised by FR-009/FR-016.
  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 5 minutes.`,
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 5 minutes.</p>`,
    });
  }

  // Support > Feedback (specs/008-sidebar-profile-account/research.md §7).
  // Sent to SUPPORT_EMAIL, falling back to the same address mail is sent
  // *from* when unset, so nothing is required to configure locally.
  // Best-effort, like sendWelcomeEmail — a transient mail-provider hiccup
  // is logged rather than surfaced as the user's fault (still returns
  // whether it actually sent, so the controller can report accurately).
  async sendFeedbackEmail(
    fromUserEmail: string,
    subject: string,
    message: string,
  ): Promise<boolean> {
    const supportEmail = this.configService.get<string>(
      'SUPPORT_EMAIL',
      this.from,
    );
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: supportEmail,
        replyTo: fromUserEmail,
        subject: `[Feedback] ${subject}`,
        text: `From: ${fromUserEmail}\n\n${message}`,
        html: `<p>From: ${fromUserEmail}</p><p>${message}</p>`,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to send feedback email from ${fromUserEmail}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Sent once, right after a successful verify-otp (FR-013). Best-effort —
  // callers must not let a failure here affect the caller's own response
  // (research.md §1, spec Assumptions).
  async sendWelcomeEmail(to: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Welcome to Fitness Tracker',
        text: 'Thanks for joining Fitness Tracker! Your account is now verified and ready to use.',
        html: '<p>Thanks for joining Fitness Tracker!</p><p>Your account is now verified and ready to use.</p>',
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send welcome email to ${to}: ${(error as Error).message}`,
      );
    }
  }
}
