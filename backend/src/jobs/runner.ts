import { Database } from '../db/pool.js';
import { EmailService } from '../shared/email.js';
import { RemoteConfigService } from '../config/remote-config.js';
import { EmailWorker } from './email-worker.js';
import { DeletionProcessor } from './deletion-processor.js';
import { ExportBuilder } from './export-builder.js';
import { ClaimExpirer } from './claim-expirer.js';
import { LedgerReconciler } from './reconciliation.js';
import { logger } from '../shared/logger.js';

export class JobRunner {
  private timers: NodeJS.Timeout[] = [];
  private isRunning: boolean = false;

  private emailWorker: EmailWorker;
  private deletionProcessor: DeletionProcessor;
  private exportBuilder: ExportBuilder;
  private claimExpirer: ClaimExpirer;
  private reconciler: LedgerReconciler;

  constructor(
    db: Database,
    emailService: EmailService,
    remoteConfig: RemoteConfigService
  ) {
    this.emailWorker = new EmailWorker(db, emailService);
    this.deletionProcessor = new DeletionProcessor(db);
    this.exportBuilder = new ExportBuilder(db);
    this.claimExpirer = new ClaimExpirer(db, remoteConfig);
    this.reconciler = new LedgerReconciler(db);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Starting background job runner...');

    // 1. Email worker (every 10s)
    this.schedule(async () => {
      await this.emailWorker.processPendingEmails();
    }, 10_000);

    // 2. Claim expirer (every 30s)
    this.schedule(async () => {
      await this.claimExpirer.expireStaleClaims();
    }, 30_000);

    // 3. Deletion processor (every 60s)
    this.schedule(async () => {
      await this.deletionProcessor.processPendingDeletions();
    }, 60_000);

    // 4. Export builder (every 60s)
    this.schedule(async () => {
      await this.exportBuilder.processPendingExports();
    }, 60_000);

    // 5. Daily ledger reconciliation (every 24h)
    this.schedule(async () => {
      await this.reconciler.reconcile();
    }, 24 * 60 * 60 * 1000);
  }

  stop() {
    this.isRunning = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    logger.info('Stopped background job runner');
  }

  private schedule(task: () => Promise<void>, intervalMs: number) {
    const timer = setInterval(async () => {
      try {
        await task();
      } catch (err) {
        logger.error({ err }, 'Error executing background job');
      }
    }, intervalMs);
    this.timers.push(timer);
  }
}
