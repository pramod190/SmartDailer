// ============================================================================
// SmartDialer — Borrower Model
// ============================================================================

export const BORROWER_STATUSES = [
  'eligible',
  'allocated',
  'completed',
  'exhausted',
  'do_not_call',
  'invalid_number',
] as const;

export type BorrowerStatus = typeof BORROWER_STATUSES[number];

export interface Borrower {
  id: string;
  campaignId: string;
  phoneNumber: string;
  status: BorrowerStatus;
  priority: number;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextEligibleAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
