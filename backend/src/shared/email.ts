import * as nodemailer from 'nodemailer';
import { Pool, PoolClient } from 'pg';
import { logger } from './logger';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string;

  constructor(config?: SmtpConfig) {
    this.fromAddress = config?.from || 'DocReader <noreply@docreaderapp.com>';
    if (config?.host) {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth:
          config.user && config.pass
            ? {
                user: config.user,
                pass: config.pass,
              }
            : undefined,
      });
    }
  }

  /**
   * Queue email to PostgreSQL email_outbox table for asynchronous dispatch
   */
  async queueEmail(
    db: Pool | PoolClient,
    toEmail: string,
    subject: string,
    bodyText: string
  ): Promise<string> {
    const res = await db.query(
      `INSERT INTO email_outbox (to_email, subject, body_text)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [toEmail, subject, bodyText]
    );
    return res.rows[0]?.id as string;
  }

  /**
   * Direct send (used by outbox worker)
   */
  async sendDirect(toEmail: string, subject: string, bodyText: string): Promise<boolean> {
    if (!this.transporter) {
      logger.info(
        { toEmail, subject },
        '[EMAIL_MOCK] SMTP not configured. Logged email to console instead of sending.'
      );
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: toEmail,
        subject,
        text: bodyText,
      });
      return true;
    } catch (err) {
      logger.error({ err, toEmail, subject }, 'Failed to deliver email via SMTP');
      throw err;
    }
  }
}

const defaultEmailService = new EmailService();

export async function queueEmail(
  db: Pool | PoolClient | any,
  toEmail: string,
  subject: string,
  bodyText: string
): Promise<string> {
  return defaultEmailService.queueEmail(db, toEmail, subject, bodyText);
}
