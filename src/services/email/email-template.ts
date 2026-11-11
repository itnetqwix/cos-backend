export interface ResetEmailTemplateProps {
  name?: string;
  resetUrl: string;
  expiresInMinutes?: number;
  appName?: string;
}

export function renderPasswordResetEmail({
  name,
  resetUrl,
  expiresInMinutes = 60,
  appName = 'Ripskis Contest OS',
}: ResetEmailTemplateProps): { subject: string; html: string; text: string } {
  const subject = `Reset your password - ${appName}`;
  const greeting = name ? `Hello ${name},` : 'Hello,';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f12; color: #e2e8f0; margin: 0; padding: 24px; }
    .card { max-width: 540px; margin: 0 auto; background-color: #12181f; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
    .logo { font-size: 20px; font-weight: 900; letter-spacing: -0.025em; color: #22c55e; margin-bottom: 24px; text-transform: uppercase; }
    h1 { font-size: 22px; font-weight: 800; color: #f8fafc; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 0 0 16px 0; }
    .btn-container { margin: 28px 0; text-align: center; }
    .btn { display: inline-block; background-color: #16a34a; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 9999px; box-shadow: 0 4px 14px 0 rgba(22, 163, 74, 0.39); }
    .note { font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 20px; margin-top: 24px; }
    .link-box { word-break: break-all; font-family: monospace; font-size: 11px; color: #22c55e; background-color: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #1e293b; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">${appName}</div>
    <h1>Password Reset Request</h1>
    <p>${greeting}</p>
    <p>We received a request to reset your password for your account on ${appName}. Click the button below to choose a new password:</p>
    
    <div class="btn-container">
      <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">Reset Your Password</a>
    </div>

    <p>This password reset link is valid for <strong>${expiresInMinutes} minutes</strong> and can only be used once.</p>
    
    <p class="note">If you did not request this password reset, please ignore this email or reach out to security support. Your password will remain unchanged.</p>
    
    <p class="note" style="margin-top: 12px; border-top: none; padding-top: 0;">
      If the button above does not work, copy and paste this URL into your browser:
      <div class="link-box">${resetUrl}</div>
    </p>
  </div>
</body>
</html>`;

  const text = `${appName} - Password Reset Request

${greeting}

We received a request to reset your password for your account on ${appName}.

To reset your password, visit the following link:
${resetUrl}

This link is valid for ${expiresInMinutes} minutes and can only be used once.

If you did not request this password reset, please ignore this email. Your password will remain unchanged.
`;

  return { subject, html, text };
}
