import type { AdCampaign } from '@/lib/ads/types'

const APPROVAL_OVERRIDE_KEYS = new Set([
  'approvalState',
  'reviewState',
  'approvedAt',
  'approvedBy',
  'approvalHistory',
  'approvalStatus',
])

export type AdsSensitiveAction =
  | 'launch'
  | 'budget'
  | 'audience'
  | 'pixel'
  | 'delete'

export function hasPersistedCampaignApproval(
  campaign: Pick<AdCampaign, 'reviewState' | 'approvedAt' | 'approvedBy'> | null | undefined,
): boolean {
  return Boolean(campaign?.reviewState === 'approved' && campaign.approvedAt && campaign.approvedBy)
}

export function requireApprovedCampaignForAdsAction(
  campaign: Pick<AdCampaign, 'id' | 'reviewState' | 'approvedAt' | 'approvedBy'> | null | undefined,
  action: AdsSensitiveAction,
): string | null {
  if (!campaign) return `Ads ${action} action requires an approved campaign gate.`
  if (!hasPersistedCampaignApproval(campaign)) {
    return `Ads ${action} action is blocked until the campaign has persisted approval evidence.`
  }
  return null
}

export function findUntrustedApprovalOverride(value: unknown, path = 'body'): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = findUntrustedApprovalOverride(value[i], `${path}[${i}]`)
      if (nested) return nested
    }
    return null
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (APPROVAL_OVERRIDE_KEYS.has(key)) return `${path}.${key}`
    const nested = findUntrustedApprovalOverride(nestedValue, `${path}.${key}`)
    if (nested) return nested
  }
  return null
}

export function approvalOverrideErrorMessage(path: string): string {
  return `Ads approval state must be loaded from persisted records, not caller-supplied fields (${path}).`
}
