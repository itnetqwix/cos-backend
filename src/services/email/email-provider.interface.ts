export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  delivered: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface EmailProvider {
  name: string;
  isConfigured(): boolean;
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
}
