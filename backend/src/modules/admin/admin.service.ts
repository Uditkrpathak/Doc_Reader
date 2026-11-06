import { Database } from '../../db/pool.js';
import { JwtService } from '../../shared/jwt.js';
import { RemoteConfigService } from '../../config/remote-config.js';
import { verifyPassword } from '../../shared/crypto.js';
import { verifyTotp } from '../../shared/totp.js';
import { AppError, ErrorCodes } from '../../shared/errors.js';
import { AdminContext } from '../../shared/types.js';
import { getServerTime } from '../../shared/time.js';

export interface AdminUserRecord {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'ADS_OPERATOR' | 'FINANCE_READONLY';
  totp_secret: string;
  password_hash: string;
}

export class AdminService {
  constructor(
    private db: Database,
    private jwt: JwtService,
    private remoteConfig: RemoteConfigService
  ) {}

  async login(email: string, password: string, totpCode: string) {
    const res = await this.db.query<AdminUserRecord>(
      `SELECT id, email, role, totp_secret, password_hash
       FROM admin_users
       WHERE email = $1;`,
      [email.toLowerCase()]
    );

    const admin = res.rows[0];
    const passwordValid = await verifyPassword(admin?.password_hash, password);

    if (!admin || !passwordValid) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid admin email or password');
    }

    const totpValid = verifyTotp(totpCode, admin.totp_secret, { window: 1 });
    if (!totpValid) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid TOTP code');
    }

    const adminCtx: AdminContext = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    };

    const token = await this.jwt.signAdminToken(adminCtx, '8h');

    return {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
      serverTime: getServerTime(),
    };
  }

  async recordAudit(
    client: any,
    adminId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    beforeState: any,
    afterState: any,
    reason: string,
    ipAddress?: string
  ) {
    await client.query(
      `INSERT INTO admin_audit_log (
         admin_id, action, target_type, target_id, before_state, after_state, reason, ip_address
       )
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8);`,
      [
        adminId,
        action,
        targetType,
        targetId,
        beforeState ? JSON.stringify(beforeState) : null,
        afterState ? JSON.stringify(afterState) : null,
        reason,
        ipAddress || null,
      ]
    );
  }

  async adjustCredits(
    admin: AdminContext,
    accountId: string,
    delta: number,
    reason: string,
    ipAddress?: string
  ) {
    if (admin.role !== 'SUPER_ADMIN') {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only SUPER_ADMIN can adjust credits');
    }

    return this.db.withTransaction(async (client) => {
      // 1. Lock account
      const accRes = await client.query<{ balance: number; version: number }>(
        `SELECT balance, version FROM credit_accounts WHERE account_id = $1::uuid FOR UPDATE;`,
        [accountId]
      );

      if (accRes.rows.length === 0 || !accRes.rows[0]) {
        throw new AppError(404, ErrorCodes.NOT_FOUND, 'Credit account not found');
      }

      const currentBalance = accRes.rows[0].balance;
      const newBalance = currentBalance + delta;

      if (newBalance < 0) {
        throw new AppError(422, ErrorCodes.BAD_REQUEST, 'Adjusting would cause negative balance');
      }

      const idempotencyKey = `admin_${admin.adminId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // 2. Append to ledger
      await client.query(
        `INSERT INTO credit_ledger_entries (
           account_id, amount, balance_after, type, idempotency_key, reference
         )
         VALUES ($1::uuid, $2, $3, 'ADMIN_ADJUST', $4, $5);`,
        [accountId, delta, newBalance, idempotencyKey, reason]
      );

      // 3. Update account balance
      await client.query(
        `UPDATE credit_accounts
         SET balance = $1, version = version + 1, updated_at = NOW()
         WHERE account_id = $2::uuid;`,
        [newBalance, accountId]
      );

      // 4. Record audit log
      await this.recordAudit(
        client,
        admin.adminId,
        'CREDIT_ADJUST',
        'credit_accounts',
        accountId,
        { balance: currentBalance },
        { balance: newBalance, delta },
        reason,
        ipAddress
      );

      return {
        accountId,
        previousBalance: currentBalance,
        newBalance,
        delta,
        serverTime: getServerTime(),
      };
    });
  }

  async updateConfig(
    admin: AdminContext,
    key: string,
    value: any,
    reason: string,
    ipAddress?: string
  ) {
    if (admin.role !== 'SUPER_ADMIN') {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only SUPER_ADMIN can update remote config');
    }

    const beforeRes = await this.db.query<{ value: any }>(
      `SELECT value FROM remote_config WHERE key = $1;`,
      [key]
    );
    const beforeValue = beforeRes.rows[0]?.value ?? null;

    await this.remoteConfig.set(this.db as any, key as any, value);

    await this.recordAudit(
      this.db,
      admin.adminId,
      'CONFIG_UPDATE',
      'remote_config',
      key,
      { [key]: beforeValue },
      { [key]: value },
      reason,
      ipAddress
    );

    return {
      key,
      value,
      serverTime: getServerTime(),
    };
  }

  async updateTicket(
    admin: AdminContext,
    ticketId: string,
    status: string,
    note?: string,
    ipAddress?: string
  ) {
    if (admin.role !== 'SUPER_ADMIN' && admin.role !== 'SUPPORT') {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Insufficient permissions to update tickets');
    }

    const beforeRes = await this.db.query<{ status: string; ticket_number: string }>(
      `SELECT status, ticket_number FROM support_tickets WHERE id = $1::uuid;`,
      [ticketId]
    );

    if (beforeRes.rows.length === 0 || !beforeRes.rows[0]) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Support ticket not found');
    }

    const beforeStatus = beforeRes.rows[0].status;

    await this.db.query(
      `UPDATE support_tickets
       SET status = $1, updated_at = NOW()
       WHERE id = $2::uuid;`,
      [status, ticketId]
    );

    await this.recordAudit(
      this.db,
      admin.adminId,
      'TICKET_STATUS_UPDATE',
      'support_tickets',
      ticketId,
      { status: beforeStatus },
      { status, note: note || null },
      note || `Status changed from ${beforeStatus} to ${status}`,
      ipAddress
    );

    return {
      id: ticketId,
      status,
      serverTime: getServerTime(),
    };
  }

  async getTickets(query: { status?: string; category?: string; limit?: number; cursor?: string }) {
    const limit = query.limit || 50;
    const params: any[] = [];
    const conditions: string[] = [];

    if (query.status) {
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }

    if (query.category) {
      params.push(query.category);
      conditions.push(`category = $${params.length}`);
    }

    if (query.cursor) {
      params.push(new Date(query.cursor));
      conditions.push(`created_at < $${params.length}`);
    }

    params.push(limit);
    const limitIdx = params.length;

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await this.db.query<{
      id: string;
      ticket_number: string;
      account_id: string | null;
      category: string;
      email: string;
      message: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, ticket_number, account_id, category, email, message, status, created_at, updated_at
       FROM support_tickets
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIdx};`,
      params
    );

    const lastRow = res.rows.length === limit ? res.rows[res.rows.length - 1] : undefined;
    const nextCursor = lastRow ? lastRow.created_at.toISOString() : null;

    return {
      tickets: res.rows,
      nextCursor,
      serverTime: getServerTime(),
    };
  }

  async getAuditLogs(query: { adminId?: string; action?: string; limit?: number; cursor?: string }) {
    const limit = query.limit || 50;
    const params: any[] = [];
    const conditions: string[] = [];

    if (query.adminId) {
      params.push(query.adminId);
      conditions.push(`admin_id = $${params.length}::uuid`);
    }

    if (query.action) {
      params.push(query.action);
      conditions.push(`action = $${params.length}`);
    }

    if (query.cursor) {
      params.push(new Date(query.cursor));
      conditions.push(`created_at < $${params.length}`);
    }

    params.push(limit);
    const limitIdx = params.length;

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await this.db.query<{
      id: string;
      admin_id: string;
      action: string;
      target_type: string;
      target_id: string | null;
      before_state: any;
      after_state: any;
      reason: string;
      ip_address: string | null;
      created_at: Date;
    }>(
      `SELECT id, admin_id, action, target_type, target_id, before_state, after_state, reason, ip_address, created_at
       FROM admin_audit_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIdx};`,
      params
    );

    const lastAudit = res.rows.length === limit ? res.rows[res.rows.length - 1] : undefined;
    const nextCursor = lastAudit ? lastAudit.created_at.toISOString() : null;

    return {
      auditLogs: res.rows,
      nextCursor,
      serverTime: getServerTime(),
    };
  }
}
