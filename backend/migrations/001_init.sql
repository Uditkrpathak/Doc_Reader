-- Universal File Viewer - Backend Initial Schema
-- Migration: 001_init.sql

-- Built-in gen_random_uuid() is standard in Postgres 13+ (no extensions needed)

-- 1. ACCOUNTS
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('GUEST', 'REGISTERED')),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PENDING_DELETION', 'DELETED', 'MERGED')),
    install_hash TEXT,
    email TEXT,
    password_hash TEXT,
    failed_logins INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    merged_into UUID REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email_active 
ON accounts(LOWER(email)) 
WHERE email IS NOT NULL AND status IN ('ACTIVE', 'PENDING_DELETION');

CREATE INDEX IF NOT EXISTS idx_accounts_install_hash 
ON accounts(install_hash) 
WHERE install_hash IS NOT NULL;

-- 2. SESSIONS (Rotating Refresh Tokens)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    family_id UUID NOT NULL,
    refresh_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON sessions(refresh_hash);

-- 3. AUTH TOKENS (Email Verification & Password Reset 6-Digit Codes)
CREATE TABLE IF NOT EXISTS auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('EMAIL_VERIFY', 'PASSWORD_RESET')),
    code_hash TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens(email, type);

-- 4. CREDIT ACCOUNTS (Balance >= 0 Enforced by Check Constraint)
CREATE TABLE IF NOT EXISTS credit_accounts (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. CREDIT LEDGER ENTRIES (Append-Only Ledger with Trigger Guard)
CREATE TABLE IF NOT EXISTS credit_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('EARN_REWARD', 'REDEEM_ADFREE', 'ADMIN_ADJUST', 'REVERSAL', 'MERGE', 'WELCOME_BONUS')),
    amount INT NOT NULL,
    balance_after INT NOT NULL CHECK (balance_after >= 0),
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ledger_account_idempotency UNIQUE(account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_account_created ON credit_ledger_entries(account_id, created_at DESC, id DESC);

-- TRIGGER: Strict ledger immutability (UPDATE and DELETE prohibited)
CREATE OR REPLACE FUNCTION enforce_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'credit_ledger_entries is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_immutability ON credit_ledger_entries;
CREATE TRIGGER trg_ledger_immutability
BEFORE UPDATE OR DELETE ON credit_ledger_entries
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_immutability();

-- 6. REWARD CLAIMS (AdMob SSV Verification Claims)
CREATE TABLE IF NOT EXISTS reward_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('STARTED', 'CREDITED', 'REJECTED', 'EXPIRED')),
    day_bucket TEXT NOT NULL, -- Format: YYYY-MM-DD in Asia/Kolkata (UTC+5:30)
    custom_data TEXT NOT NULL,
    provider_txn_id TEXT UNIQUE,
    credits_granted INT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reward_claims_account_day ON reward_claims(account_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_reward_claims_status_expires ON reward_claims(status, expires_at);

-- 7. ENTITLEMENTS (Unique per account_id + kind)
CREATE TABLE IF NOT EXISTS entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('ADFREE_CREDIT', 'PREMIUM')),
    ends_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_entitlement_account_kind UNIQUE (account_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_lookup ON entitlements(account_id, kind);

-- 8. PURCHASE RECORDS (Google Play Billing Subscriptions & Lifetime Products)
CREATE TABLE IF NOT EXISTS purchase_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    purchase_token TEXT UNIQUE NOT NULL,
    product_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('SUBSCRIPTION', 'ONE_TIME')),
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD', 'PENDING', 'ON_HOLD', 'PAUSED', 'EXPIRED', 'REVOKED')),
    expires_at TIMESTAMPTZ NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    last_event_at TIMESTAMPTZ NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_records_account ON purchase_records(account_id);
CREATE INDEX IF NOT EXISTS idx_purchase_records_unack ON purchase_records(acknowledged) WHERE acknowledged = FALSE;

-- 9. PROCESSED EVENTS (Pub/Sub & Webhook Deduplication)
CREATE TABLE IF NOT EXISTS processed_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. CONSENT RECORDS (Append-Only Consent Tracking)
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('USAGE_ANALYTICS', 'PERSONALISED_CONTENT', 'PERSONALISED_ADS', 'CRASH_DIAGNOSTICS')),
    granted BOOLEAN NOT NULL,
    policy_version TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_account_purpose ON consent_records(account_id, purpose, created_at DESC);

-- 11. PRIVACY REQUESTS (One open request per type per account)
CREATE TABLE IF NOT EXISTS privacy_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('EXPORT', 'DELETE')),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED')),
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_privacy_request 
ON privacy_requests(account_id, type) 
WHERE status IN ('PENDING', 'PROCESSING');

-- 12. DATA EXPORTS (Single-Use 24h JSON Downloads)
CREATE TABLE IF NOT EXISTS data_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    privacy_request_id UUID REFERENCES privacy_requests(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    downloaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. CAMPAIGNS (First-Party Ads with Auto-Pause Threshold)
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    complaint_count INT NOT NULL DEFAULT 0,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. AD REPORTS
CREATE TABLE IF NOT EXISTS ad_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    placement TEXT NOT NULL,
    reasons TEXT[] NOT NULL,
    details TEXT,
    ad_source TEXT NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    ad_response_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. PROBLEM REPORTS (Strict Diagnostic telemetry - Zero file names or paths!)
CREATE TABLE IF NOT EXISTS problem_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    problem_type TEXT NOT NULL,
    details TEXT,
    file_extension TEXT NOT NULL,
    detected_type TEXT NOT NULL,
    size_bucket TEXT NOT NULL,
    error_code TEXT,
    engine TEXT NOT NULL,
    app_version TEXT NOT NULL,
    os_version TEXT NOT NULL,
    device_model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. SUPPORT TICKETS
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. FAQ ITEMS
CREATE TABLE IF NOT EXISTS faq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    locale TEXT NOT NULL DEFAULT 'en',
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_locale_category ON faq_items(locale, category, sort_order);

-- 18. REMOTE CONFIG
CREATE TABLE IF NOT EXISTS remote_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. EMAIL OUTBOX (Guarded Background Dispatch)
CREATE TABLE IF NOT EXISTS email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_pending ON email_outbox(status, next_attempt_at) WHERE status IN ('PENDING', 'PROCESSING');

-- 20. ADMIN USERS (RFC 6238 TOTP)
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'SUPPORT', 'ADS_OPERATOR', 'FINANCE_READONLY')),
    totp_secret TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21. ADMIN AUDIT LOG (Append-Only)
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_state JSONB,
    after_state JSONB,
    reason TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);

-- DEFAULT REMOTE CONFIG VALUES
INSERT INTO remote_config (key, value, updated_at) VALUES
('creditsPerReward', '10'::jsonb, NOW()),
('dailyLimit', '5'::jsonb, NOW()),
('claimTtlSeconds', '600'::jsonb, NOW()),
('adFreeTiers', '{
  "h1": { "durationHours": 1, "cost": 20, "label": "1 Hour Ad-Free" },
  "h24": { "durationHours": 24, "cost": 60, "label": "24 Hours Ad-Free" },
  "d7": { "durationHours": 168, "cost": 300, "label": "7 Days Ad-Free" }
}'::jsonb, NOW()),
('killSwitches', '{
  "rewardedAds": false,
  "signups": false,
  "firstPartyAds": false
}'::jsonb, NOW()),
('allowRedeemWhilePremium', 'false'::jsonb, NOW()),
('firstPartyAdComplaintThreshold', '10'::jsonb, NOW()),
('minAppVersion', '"1.0.0"'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;
