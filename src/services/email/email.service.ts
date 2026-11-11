import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from './email-provider.interface.js';
import { renderPasswordResetEmail, renderVerificationEmail } from './email-template.js';

export class NullEmailProvider implements EmailProvider {
  name = 'null';

  isConfigured(): boolean {
    return false;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    logger.warn(
      `[EMAIL] No external email provider is configured. Password reset email to <${options.to}> was NOT sent externally. Configure RESEND_API_KEY or SMTP settings in your environment for production delivery.`,
    );
    return {
      delivered: false,
      provider: this.name,
      error: 'No external email provider configured',
    };
  }
}

export class ResendEmailProvider implements EmailProvider {
  name = 'resend';
  private apiKey: string;
  private from: string;

  constructor(apiKey: string, from?: string) {
    this.apiKey = apiKey;
    this.from = from || env.EMAIL_FROM || 'Ripskis <noreply@ripskis.com>';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error(
          `[EMAIL] Resend delivery failed: HTTP ${response.status}`,
          errorData,
        );
        return {
          delivered: false,
          provider: this.name,
          error: `Resend error: HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as { id?: string };
      logger.info(
        `[EMAIL] Email successfully dispatched via Resend (id: ${data.id}) to ${options.to}`,
      );
      return {
        delivered: true,
        messageId: data.id,
        provider: this.name,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[EMAIL] Exception during Resend delivery: ${message}`);
      return {
        delivered: false,
        provider: this.name,
        error: message,
      };
    }
  }
}

export class EmailService {
  private static providerInstance: EmailProvider | null = null;

  static getProvider(): EmailProvider {
    if (this.providerInstance) return this.providerInstance;

    if (env.RESEND_API_KEY) {
      this.providerInstance = new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
      return this.providerInstance;
    }

    this.providerInstance = new NullEmailProvider();
    return this.providerInstance;
  }

  /**
   * For testing or custom mocking.
   */
  static setProvider(provider: EmailProvider | null): void {
    this.providerInstance = provider;
  }

  static frontendBase(): string {
    let baseUrl = env.FRONTEND_URL;
    if (!baseUrl) {
      baseUrl =
        env.NODE_ENV === 'production'
          ? 'https://www.ripskis.com'
          : 'http://localhost:3000';
    }
    if (env.NODE_ENV === 'production' && baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace(/^http:\/\//, 'https://');
    }
    return baseUrl.replace(/\/+$/, '');
  }

  static getResetPasswordUrl(rawToken: string): string {
    return `${this.frontendBase()}/reset-password?token=${encodeURIComponent(rawToken)}`;
  }

  static getVerifyEmailUrl(rawToken: string): string {
    return `${this.frontendBase()}/verify-email?token=${encodeURIComponent(rawToken)}`;
  }

  static async sendPasswordResetEmail(
    user: { email: string; name?: string },
    rawToken: string,
  ): Promise<SendEmailResult> {
    const resetUrl = this.getResetPasswordUrl(rawToken);
    const { subject, html, text } = renderPasswordResetEmail({
      name: user.name,
      resetUrl,
      expiresInMinutes: 60,
    });

    const provider = this.getProvider();
    return provider.sendEmail({
      to: user.email,
      subject,
      html,
      text,
    });
  }

  static async sendVerificationEmail(
    user: { email: string; name?: string },
    rawToken: string,
  ): Promise<SendEmailResult> {
    const verifyUrl = this.getVerifyEmailUrl(rawToken);
    const { subject, html, text } = renderVerificationEmail({
      name: user.name,
      verifyUrl,
      expiresInMinutes: 60,
    });
    return this.getProvider().sendEmail({
      to: user.email,
      subject,
      html,
      text,
    });
  }
}
