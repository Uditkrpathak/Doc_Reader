export type AccountKind = 'GUEST' | 'REGISTERED';
export type AccountStatus = 'ACTIVE' | 'PENDING_DELETION' | 'DELETED' | 'MERGED';

export type LedgerEntryType =
  | 'EARN_REWARD'
  | 'REDEEM_ADFREE'
  | 'ADMIN_ADJUST'
  | 'REVERSAL'
  | 'MERGE'
  | 'WELCOME_BONUS';

export type ClaimStatus = 'STARTED' | 'CREDITED' | 'REJECTED' | 'EXPIRED';

export type EntitlementKind = 'ADFREE_CREDIT' | 'PREMIUM';

export type PurchaseKind = 'SUBSCRIPTION' | 'ONE_TIME';

export type PurchaseState =
  | 'ACTIVE'
  | 'CANCELED'
  | 'IN_GRACE_PERIOD'
  | 'PENDING'
  | 'ON_HOLD'
  | 'PAUSED'
  | 'EXPIRED'
  | 'REVOKED';

export type PrivacyRequestType = 'EXPORT' | 'DELETE';
export type PrivacyRequestStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED';

export type AdminRole = 'SUPER_ADMIN' | 'SUPPORT' | 'ADS_OPERATOR' | 'FINANCE_READONLY';

export interface UserContext {
  accountId: string;
  kind: AccountKind;
  email?: string;
  sessionId?: string;
}

export interface AdminContext {
  adminId: string;
  email: string;
  role: AdminRole;
}

