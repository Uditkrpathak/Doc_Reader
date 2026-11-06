import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';
import { logger } from '../shared/logger';

export async function runMigrations(db: Pool | PoolClient): Promise<string[]> {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.warn(`Migrations directory not found at: ${migrationsDir}`);
    return [];
  }

  // Create schema_migrations tracker
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRows = await db.query(`SELECT version FROM schema_migrations`);
  const appliedSet = new Set(appliedRows.rows.map((r) => r.version));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (!appliedSet.has(file)) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      logger.info({ file }, `Applying database migration: ${file}`);
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
        await db.query('COMMIT');
        newlyApplied.push(file);
      } catch (err) {
        await db.query('ROLLBACK');
        logger.error({ err, file }, `Failed to execute migration ${file}`);
        throw err;
      }
    }
  }

  return newlyApplied;
}

if (require.main === module) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  runMigrations(pool)
    .then((applied) => {
      console.log(`Applied ${applied.length} migrations:`, applied);
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

