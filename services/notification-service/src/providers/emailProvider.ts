import { Logger } from '@system/shared';
import { config } from '../config';

const logger = new Logger({ serviceName: 'notification-service' });

export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html: string;
  correlationId?: string;
}

export interface IEmailProvider {
  sendEmail(message: EmailMessage): Promise<{ messageId: string; success: boolean }>;
}

export class MockEmailProvider implements IEmailProvider {
  async sendEmail(message: EmailMessage): Promise<{ messageId: string; success: boolean }> {
    const from = message.from || config.emailFrom;
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    logger.info(`[EMAIL DISPATCHED] To: ${message.to} | Subject: "${message.subject}" | MessageId: ${messageId}`, {
      correlationId: message.correlationId,
      recipient: message.to,
      subject: message.subject,
      messageId,
    });

    // In local dev, print a clean simulated email box
    if (config.nodeEnv !== 'production') {
      console.log(`\n================== [OUTGOING EMAIL NOTIFICATION] ==================`);
      console.log(`From:    ${from}`);
      console.log(`To:      ${message.to}`);
      console.log(`Subject: ${message.subject}`);
      console.log(`MessageId: ${messageId}`);
      console.log(`Time:    ${new Date().toISOString()}`);
      console.log(`----------------------------- CONTENT -----------------------------`);
      console.log(message.text);
      console.log(`===================================================================\n`);
    }

    return { messageId, success: true };
  }
}

export class EmailTemplateEngine {
  static welcomeEmail(name: string, email: string): { subject: string; text: string; html: string } {
    const subject = `Welcome to the Platform, ${name}!`;
    const text = `Hello ${name},\n\nWelcome to our microservices platform! Your account (${email}) has been successfully created.\n\nEnjoy secure, high-performance distributed systems.\n\nBest regards,\nThe Microservices Team`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Welcome to the Platform, ${name}!</h2>
        <p>Your account (<strong>${email}</strong>) has been successfully created.</p>
        <p>You can now log in securely using your credentials.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">This is an automated notification sent via NATS JetStream event-driven pipeline.</p>
      </div>
    `;
    return { subject, text, html };
  }

  static securityAlertPasswordChanged(
    name: string,
    email: string,
    timestamp: string,
    ipAddress?: string
  ): { subject: string; text: string; html: string } {
    const subject = `SECURITY ALERT: Password changed for your account`;
    const text = `Hello ${name},\n\nThis is a security alert to confirm that the password for your account (${email}) was recently changed.\n\nTime: ${timestamp}\nIP Address: ${ipAddress || 'Not recorded'}\n\nIf you did not perform this change, please contact support immediately.\n\nBest regards,\nSecurity Team`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #ef4444; border-radius: 8px;">
        <h2 style="color: #dc2626;">SECURITY ALERT: Password Changed</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>The password for your account (<strong>${email}</strong>) was changed at <strong>${timestamp}</strong>.</p>
        <p><strong>IP Address:</strong> ${ipAddress || 'Unknown'}</p>
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 15px 0;">
          <p style="margin: 0; color: #991b1b; font-weight: bold;">If you did not make this change, please contact our security team immediately.</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">Dispatched asynchronously via NATS JetStream broker.</p>
      </div>
    `;
    return { subject, text, html };
  }

  static profileUpdatedEmail(
    name: string,
    email: string,
    updatedFields: string[],
    timestamp: string
  ): { subject: string; text: string; html: string } {
    const subject = `Your profile information was updated`;
    const text = `Hello ${name},\n\nYour profile was updated at ${timestamp}.\nUpdated attributes: ${updatedFields.join(', ')}\n\nBest regards,\nThe Team`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Profile Information Updated</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Your profile was updated at <strong>${timestamp}</strong>.</p>
        <p>Updated fields: <code>${updatedFields.join(', ')}</code></p>
      </div>
    `;
    return { subject, text, html };
  }

  static accountDeletedEmail(email: string, timestamp: string): { subject: string; text: string; html: string } {
    const subject = `Your account has been deleted`;
    const text = `Hello,\n\nYour account associated with ${email} was permanently deleted on ${timestamp}.\n\nThank you for having been with us.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #cbd5e1; border-radius: 8px;">
        <h2>Account Deleted</h2>
        <p>Your account associated with <strong>${email}</strong> was permanently deleted on <strong>${timestamp}</strong>.</p>
      </div>
    `;
    return { subject, text, html };
  }
}
