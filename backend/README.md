# Universal File Viewer — Production Backend

A high-performance, strictly isolated backend service powering identity, rewards, credit wallet, ad-free access, Google Play subscriptions, DPDP Act 2023 compliance, support, and administrative tooling for the **Universal File Viewer** mobile application (India launch).

---

## 🔒 Security & Privacy Guarantees

1. **Zero File Storage Guarantee**:
   All files are processed entirely offline on the user's mobile device. The backend never accepts, inspects, stores, or logs file names, file paths, or file contents.
2. **Server-Authoritative Economy**:
   The client is never trusted for credits, daily limits, ad-free duration, or subscription state.
3. **Strict DB-Enforced Ledger Immutability**:
   The `credit_ledger_entries` table enforces a database trigger that prohibits `UPDATE` and `DELETE` operations. An account balance is physically barred from dropping below zero via a `CHECK (balance >= 0)` constraint.
4. **Deadlock-Free Two-Account Merges**:
   When transferring balances or merging guest accounts, account IDs are sorted lexicographically (`[idA, idB].sort()`) before running `SELECT ... FOR UPDATE`.
5. **Strict Idempotency**:
   Every state-modifying endpoint requires an `Idempotency-Key` header with database uniqueness constraints (`UNIQUE (account_id, idempotency_key)`).
6. **Time Authority & Indian Day-Bucket Reset**:
   All timestamps originate from the server. Daily rewarded ad caps (default: 5/day) reset precisely at midnight India Standard Time (UTC+5:30 / Asia/Kolkata).
7. **DPDP Act 2023 Compliance**:
   Provides an append-only consent trail, single open compliance request limit, automated 24-hour single-use data exports, and complete anonymized account tombstones upon deletion.

---

## 🛠️ Stack & Technologies

- **Runtime**: Node.js 20+ (ESM / TypeScript Strict)
- **Framework**: Fastify 4.x with `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`
- **Database**: PostgreSQL 16 (Native `pg` driver, zero ORM, raw SQL migrations)
- **Cache & Rate Limiting**: Redis 7.x
- **Validation**: Strict Zod (rejects unauthorized fields, location payloads, or file names)
- **Cryptography**: Argon2id password hashing, RFC 6238 TOTP, Ed25519 EdDSA for offline tokens, SHA-256 HMAC
- **Email Delivery**: Asynchronous PostgreSQL `email_outbox` queue with `nodemailer` SMTP worker
- **Testing**: Vitest with isolated in-memory PGlite test harness

---

## 🚀 Quick Start

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 20+ and npm

### 2. Run with Docker Compose
```bash
cd backend
docker-compose up -d --build
```
This boots up:
- Fastify API on `http://localhost:3000`
- PostgreSQL 16 on port `5432`
- Redis 7 on port `6379`

### 3. Run Locally for Development
```bash
cd backend
npm install
cp .env.example .env

# Generate Ed25519 signing keys
npm run keys

# Run database migrations
npm run migrate

# Start development server with live reload
npm run dev
```

### 4. Create Initial Super Admin
```bash
npm run admin:create admin@docreader.app AdminPass123! SUPER_ADMIN
```
Outputs the TOTP Secret and QR/URI string to import into Google Authenticator or 1Password.

---

## ⚙️ Environment Variables

| Variable | Description | Default / Example |
|---|---|---|
| `NODE_ENV` | Environment mode (`development`, `production`, `test`) | `development` |
| `PORT` | HTTP port | `3000` |
| `DATABASE_URL` | PostgreSQL 16 connection string | `postgresql://docreader:secure_pass_123@localhost:5432/docreader` |
| `REDIS_URL` | Redis URL for distributed rate limits | `redis://localhost:6379` |
| `JWT_SECRET` | 32+ char secret for user access tokens (15m) | Required |
| `ADMIN_JWT_SECRET` | 32+ char secret for admin tokens (8h) | Required |
| `OFFLINE_TOKEN_PRIVATE_KEY` | PKCS#8 PEM Ed25519 Private Key | Generated via `npm run keys` |
| `OFFLINE_TOKEN_PUBLIC_KEY` | SPKI PEM Ed25519 Public Key | Generated via `npm run keys` |
| `GOOGLE_PUBSUB_AUDIENCE` | Google Cloud Pub/Sub audience for RTDN | Optional in dev |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Expected Google Play service account | Optional in dev |
| `SMTP_HOST` | Outbound SMTP server | e.g. `email-smtp.ap-south-1.amazonaws.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials | Redacted in logs |
| `EMAIL_FROM` | Sender display address | `DocReader <noreply@docreaderapp.com>` |
| `SUPPORT_EMAIL` | Destination support inbox | `support@docreader.app` |

---

## 📱 Architecture & Domain Modules

```
backend/
├── migrations/
│   └── 001_init.sql         # 21 tables, constraints, triggers, indexes
├── scripts/
│   ├── create-admin.ts      # CLI utility to provision admin with RFC 6238 TOTP
│   └── generate-keys.ts     # CLI utility to generate Ed25519 keypairs
├── src/
│   ├── app.ts               # Fastify assembly, security plugins, error handler
│   ├── server.ts            # Entrypoint, migration check, graceful shutdown
│   ├── config/
│   │   ├── env.ts           # Strict Zod environment validation
│   │   └── remote-config.ts # In-memory cached remote config with DB sync
│   ├── db/
│   │   ├── migrator.ts      # Lightweight sequential SQL migrator
│   │   └── pool.ts          # PG pool wrapper with transaction & deadlock locking
│   ├── jobs/
│   │   ├── runner.ts        # Central scheduler with advisory lock guards
│   │   ├── email-worker.ts  # Outbox worker with exponential backoff
│   │   ├── claim-expirer.ts # Stale STARTED claims cleaner
│   │   ├── deletion-processor.ts # DPDP account anonymization worker
│   │   ├── export-builder.ts     # DPDP 24h JSON export compiler
│   │   └── reconciliation.ts     # 24h ledger vs balance integrity checker
│   ├── modules/
│   │   ├── identity/        # Guest/Registered accounts, sessions, password reset
│   │   ├── wallet/          # Credit ledger, ad-free redemptions, Ed25519 offline tokens
│   │   ├── rewards/         # AdMob SSV verification, day-bucket caps
│   │   ├── billing/         # Google Play subscriptions, lifetime, Pub/Sub webhook
│   │   ├── privacy/         # DPDP consents, exports, deletion requests
│   │   ├── support/         # Ad reports, problem reports, tickets, FAQ
│   │   ├── config/          # Public config with ETag caching, /healthz, /readyz
│   │   └── admin/           # RFC 6238 TOTP login, audit log, RBAC
│   └── shared/              # Common errors, types, crypto, time, jwt, totp, logger
└── tests/                   # Complete integration test suites (Vitest + PGlite)
```

---

## 📡 Webhook Integrations

### 1. AdMob Rewarded Video Server-Side Verification (SSV)
- **Endpoint**: `GET /v1/webhooks/admob-ssv`
- **Setup in AdMob Console**:
  Set Callback URL to: `https://<your-host>/v1/webhooks/admob-ssv`
- **Verification Flow**:
  1. AdMob pings the webhook with query parameters including `custom_data`, `signature`, `key_id`, and `transaction_id`.
  2. The server verifies ECDSA SHA-256 against Google's public keys fetched from `https://www.gstatic.com/admob/reward/verifier-keys.json`.
  3. The `custom_data` contains `{ "userId": "<accountId>", "claimId": "<uuid>" }`.
  4. Once verified, the claim transition from `STARTED` to `CREDITED` runs in an atomic transaction:
     - Adds reward credits (e.g., +10).
     - Appends an `EARN_REWARD` entry to `credit_ledger_entries`.
     - Updates `credit_accounts`.
  5. Fully idempotent: Duplicate AdMob pings with the same `transaction_id` safely return HTTP 200 without double-crediting.

### 2. Google Play Real-Time Developer Notifications (RTDN)
- **Endpoint**: `POST /v1/webhooks/google-play`
- **Setup in Google Cloud Console**:
  1. Create a Cloud Pub/Sub Topic: `play-billing-notifications`.
  2. Create a Push Subscription pointing to: `https://<your-host>/v1/webhooks/google-play`.
  3. Enable OIDC Authentication with Audience: `https://<your-host>/v1/webhooks/google-play`.
- **Supported Events**:
  - `SUBSCRIPTION_PURCHASED` / `SUBSCRIPTION_RENEWED`: Grants or extends `PREMIUM` entitlement.
  - `SUBSCRIPTION_IN_GRACE_PERIOD`: Keeps entitlement active while user fixes payment method.
  - `SUBSCRIPTION_ON_HOLD`: Revokes entitlement until resolved.
  - `SUBSCRIPTION_REVOKED` / `SUBSCRIPTION_CANCELED`: Handles auto-renew cancellation and instant refunds.
  - `ONE_TIME_PRODUCT`: Grants lifetime `PREMIUM` entitlement (expiry set to Year 9999).

---

## 📑 API Reference

All write endpoints require the `Idempotency-Key: <unique-string>` header.
Responses adhere to standard error and payload formats with `serverTime` ISO strings.

### Error Response Shape
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Detailed description of error",
    "request_id": "a9a3b2b1-...",
    "retryable": false
  }
}
```

### Identity & Authentication
- `POST /v1/auth/guest`: Create or resume a guest account via `installId`.
- `POST /v1/auth/signup`: Convert guest or create registered email/password account.
- `POST /v1/auth/login`: Authenticate with email/password (lockout after 5 failures).
- `POST /v1/auth/refresh`: Rotate refresh token with token family reuse revocation.
- `POST /v1/auth/logout`: Revoke session.
- `POST /v1/auth/forgot-password`: Timing-safe password reset code request.
- `POST /v1/auth/reset-password`: Complete password reset with 6-digit code.

### Wallet & Entitlements
- `GET /v1/wallet`: Current balance, status, server time.
- `GET /v1/wallet/ledger`: Paginated append-only transaction history.
- `GET /v1/adfree/options`: Available tiers (`1h/20`, `24h/60`, `7d/300`).
- `POST /v1/adfree/redemptions`: Redeem credits for ad-free time with Ed25519 offline token.
- `GET /v1/entitlements`: Active ad-free and premium entitlement statuses.

### Rewarded Ads
- `POST /v1/rewards/claims`: Initiate ad claim and check daily limit (5/day).
- `GET /v1/rewards/claims/:id`: Poll claim status (`STARTED`, `CREDITED`, `REJECTED`, `EXPIRED`).
- `GET /v1/webhooks/admob-ssv`: AdMob SSV verification webhook.

### Billing
- `POST /v1/billing/verify`: Validate Google Play purchase token.
- `POST /v1/billing/restore`: Re-link active purchases to current user account.
- `POST /v1/webhooks/google-play`: Pub/Sub webhook for subscription lifecycle.

### Privacy & DPDP Act 2023
- `GET /v1/consents`: Fetch active consent settings.
- `PUT /v1/consents`: Append consent choices (`USAGE_ANALYTICS`, `PERSONALISED_ADS`, etc.).
- `POST /v1/privacy/requests`: Submit compliance request (`EXPORT` or `DELETE`).
- `GET /v1/privacy/exports/:token`: Single-use 24-hour JSON download.

### Support & Diagnostics
- `POST /v1/reports/ad`: Report ad (increments complaints and auto-pauses at threshold 10).
- `POST /v1/reports/problem`: Diagnostic report (strictly rejects file names/paths).
- `POST /v1/support/tickets`: Open support ticket and queue confirmation emails.
- `GET /v1/help/faq`: Localized FAQ with ETag caching and English fallback.

### Configuration & Health
- `GET /v1/config`: Remote config with ETag caching.
- `GET /healthz`: Liveness probe.
- `GET /readyz`: Readiness probe (verifies database connectivity).

### Admin API (RBAC + RFC 6238 TOTP)
- `POST /v1/admin/login`: Admin authentication with password and TOTP.
- `POST /v1/admin/credits/adjust`: (`SUPER_ADMIN`) Manual balance adjustments with audit logging.
- `PUT /v1/admin/config/:key`: (`SUPER_ADMIN`) Update remote config values live.
- `GET /v1/admin/tickets`: Support ticket queue.
- `PATCH /v1/admin/tickets/:id`: Update ticket status (`IN_PROGRESS`, `RESOLVED`, `CLOSED`).
- `GET /v1/admin/audit`: Searchable, paginated audit logs.

---

## 🧪 Testing

The test suite runs against an isolated, in-memory PostgreSQL engine (`@electric-sql/pglite`) without requiring a live database daemon:

```bash
cd backend

# Run all test suites
npm test

# Run with file watch
npm run test:watch

# Run TypeScript type check
npm run typecheck
```

