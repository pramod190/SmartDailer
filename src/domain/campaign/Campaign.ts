// ============================================================================
// SmartDialer — Campaign Model
// ============================================================================

export const CAMPAIGN_STATUSES = ['created', 'active', 'paused', 'completed', 'cancelled'] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];

export const CAMPAIGN_MODES = ['progressive', 'predictive'] as const;
export type CampaignMode = typeof CAMPAIGN_MODES[number];

export interface CampaignConfig {
  maxConcurrentCalls?: number;
  safetyBuffer?: number;
  answerRateWindow?: number;
  maxOverdialRatio?: number;
  maxAttempts?: number;
  retryBackoffSec?: number;
  targetAbandonmentRate?: number;
}

export interface Campaign {
  id: string;
  name: string;
  mode: CampaignMode;
  status: CampaignStatus;
  configJson: string;   // JSON-serialized CampaignConfig
  createdAt: string;
  updatedAt: string;
}

export function parseCampaignConfig(json: string): CampaignConfig {
  try {
    return JSON.parse(json) as CampaignConfig;
  } catch {
    return {};
  }
}
