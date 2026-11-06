import { Database } from '../db/pool.js';
import { logger } from '../shared/logger.js';

export const RECONCILIATION_LOCK_ID = 1006;

export interface ReconciliationDiscrepancy {
  accountId: string;
  storedBalance: number;
  calculatedBalance: number;
  diff: number;
}

export interface ReconciliationReport {
  timestamp: string;
  totalAccountsChecked: number;
  healthyCount: number;
  discrepancies: ReconciliationDiscrepancy[];
}

export class LedgerReconciler {
  constructor(private db: Database) {}

  async reconcile(): Promise<ReconciliationReport> {
    const locked = await this.db.tryAdvisoryLock(RECONCILIATION_LOCK_ID);
    if (!locked) {
      throw new Error('Ledger reconciliation lock already acquired by another worker');
    }

    try {
      const res = await this.db.query<{
        account_id: string;
        stored_balance: number;
        calculated_balance: string;
      }>(
        `SELECT
           a.account_id,
           a.balance AS stored_balance,
           COALESCE(SUM(l.amount), 0)::text AS calculated_balance
         FROM credit_accounts a
         LEFT JOIN credit_ledger_entries l ON a.account_id = l.account_id
         GROUP BY a.account_id, a.balance;`
      );

      const discrepancies: ReconciliationDiscrepancy[] = [];
      let healthyCount = 0;

      for (const row of res.rows) {
        const stored = row.stored_balance;
        const calculated = parseInt(row.calculated_balance, 10);

        if (stored !== calculated) {
          discrepancies.push({
            accountId: row.account_id,
            storedBalance: stored,
            calculatedBalance: calculated,
            diff: stored - calculated,
          });
        } else {
          healthyCount++;
        }
      }

      const report: ReconciliationReport = {
        timestamp: new Date().toISOString(),
        totalAccountsChecked: res.rows.length,
        healthyCount,
        discrepancies,
      };

      if (discrepancies.length > 0) {
        logger.error(
          { discrepancyCount: discrepancies.length, discrepancies },
          'LEDGER RECONCILIATION FAILURE: Discrepancies detected between credit_accounts and credit_ledger_entries!'
        );
      } else {
        logger.info(
          { totalAccounts: res.rows.length },
          'Ledger reconciliation completed: 100% integrity verified'
        );
      }

      return report;
    } finally {
      await this.db.advisoryUnlock(RECONCILIATION_LOCK_ID);
    }
  }
}

