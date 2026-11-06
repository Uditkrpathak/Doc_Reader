import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/shared/crypto.js';
import { generateTotpSecret, generateTotpUri } from '../src/shared/totp.js';

async function main() {
  const email = process.argv[2] || 'admin@docreader.app';
  const password = process.argv[3] || 'AdminPass123!';
  const role = process.argv[4] || 'SUPER_ADMIN';

  console.log(`Creating admin: ${email} (${role})`);

  const passwordHash = await hashPassword(password);
  const totpSecret = generateTotpSecret();
  const totpUri = generateTotpUri(totpSecret, email, 'DocReader Admin');

  const res = await pool.query(
    `INSERT INTO admin_users (email, password_hash, role, totp_secret)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
     SET password_hash = $2, role = $3, totp_secret = $4
     RETURNING id, email, role;`,
    [email.toLowerCase(), passwordHash, role, totpSecret]
  );

  console.log('\n--- Admin Created Successfully ---');
  console.log('ID:', res.rows[0].id);
  console.log('Email:', res.rows[0].email);
  console.log('Role:', res.rows[0].role);
  console.log('TOTP Secret (Base32):', totpSecret);
  console.log('TOTP URI (Scan into Authenticator app):', totpUri);
  console.log('----------------------------------\n');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

