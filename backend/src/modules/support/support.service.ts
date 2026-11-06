import crypto from 'node:crypto';
import { Database } from '../../db/pool.js';
import { getServerTime } from '../../shared/time.js';
import { queueEmail } from '../../shared/email.js';

export interface AdReportData {
  placement: string;
  reasons: string[];
  details?: string;
  adSource: string;
  campaignId?: string;
  adResponseId?: string;
}

export interface ProblemReportData {
  problemType: string;
  details?: string;
  fileExtension: string;
  detectedType: string;
  sizeBucket: string;
  errorCode?: string;
  engine: string;
  appVersion: string;
  osVersion: string;
  deviceModel: string;
}

export interface SupportTicketData {
  category: string;
  email: string;
  message: string;
}

export class SupportService {
  constructor(private db: Database) {}

  async reportAd(accountId: string | null, data: AdReportData) {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO ad_reports (account_id, placement, reasons, details, ad_source, campaign_id, ad_response_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7)
       RETURNING id;`,
      [
        accountId,
        data.placement,
        data.reasons,
        data.details || null,
        data.adSource,
        data.campaignId || null,
        data.adResponseId || null,
      ]
    );

    // If a first-party campaign was reported, increment complaints and auto-pause at threshold (>= 10)
    if (data.campaignId) {
      await this.db.query(
        `UPDATE campaigns
         SET complaint_count = complaint_count + 1,
             paused = CASE WHEN complaint_count + 1 >= 10 THEN TRUE ELSE paused END
         WHERE id = $1::uuid;`,
        [data.campaignId]
      );
    }

    return {
      id: res.rows[0]!.id,
      serverTime: getServerTime(),
    };
  }

  async reportProblem(accountId: string | null, data: ProblemReportData) {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO problem_reports (
         account_id, problem_type, details, file_extension, detected_type,
         size_bucket, error_code, engine, app_version, os_version, device_model
       )
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id;`,
      [
        accountId,
        data.problemType,
        data.details || null,
        data.fileExtension,
        data.detectedType,
        data.sizeBucket,
        data.errorCode || null,
        data.engine,
        data.appVersion,
        data.osVersion,
        data.deviceModel,
      ]
    );

    return {
      id: res.rows[0]!.id,
      serverTime: getServerTime(),
    };
  }

  async createSupportTicket(accountId: string | null, data: SupportTicketData) {
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const ticketNumber = `TICK-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`;

    const res = await this.db.query<{
      id: string;
      ticket_number: string;
      status: string;
      created_at: Date;
    }>(
      `INSERT INTO support_tickets (ticket_number, account_id, category, email, message, status)
       VALUES ($1, $2::uuid, $3, $4, $5, 'OPEN')
       RETURNING id, ticket_number, status, created_at;`,
      [ticketNumber, accountId, data.category, data.email, data.message]
    );

    const ticket = res.rows[0]!;

    // Queue acknowledgment email to the user
    await queueEmail(
      this.db,
      data.email,
      `Support Request Received [${ticket.ticket_number}]`,
      `Hello,\n\nWe received your request regarding "${data.category}". Ticket number: ${ticket.ticket_number}.\nOur support team will review it shortly.\n\nBest regards,\nUniversal File Viewer Team`
    );

    // Queue notification email to the support inbox
    const supportInbox = process.env.SUPPORT_EMAIL || 'support@docreader.app';
    await queueEmail(
      this.db,
      supportInbox,
      `[Support] New Ticket: ${ticket.ticket_number} (${data.category})`,
      `Ticket: ${ticket.ticket_number}\nCategory: ${data.category}\nUser: ${data.email}\nAccount ID: ${accountId || 'Guest'}\n\nMessage:\n${data.message}`
    );

    return {
      ticketNumber: ticket.ticket_number,
      status: ticket.status,
      serverTime: getServerTime(),
    };
  }

  async getFaq(locale: string = 'en') {
    let res = await this.db.query<{
      id: string;
      category: string;
      question: string;
      answer: string;
      sort_order: number;
    }>(
      `SELECT id, category, question, answer, sort_order
       FROM faq_items
       WHERE locale = $1
       ORDER BY category, sort_order;`,
      [locale]
    );

    // Fallback to English if no items for requested locale
    if (res.rows.length === 0 && locale !== 'en') {
      res = await this.db.query(
        `SELECT id, category, question, answer, sort_order
         FROM faq_items
         WHERE locale = 'en'
         ORDER BY category, sort_order;`
      );
    }

    const items = res.rows.map((r) => ({
      id: r.id,
      category: r.category,
      question: r.question,
      answer: r.answer,
      sortOrder: r.sort_order,
    }));

    const json = JSON.stringify(items);
    const etag = `"${crypto.createHash('sha256').update(json).digest('hex').slice(0, 16)}"`;

    return { items, etag };
  }
}
