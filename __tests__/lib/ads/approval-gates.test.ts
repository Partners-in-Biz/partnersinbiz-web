import {
  approvalOverrideErrorMessage,
  findUntrustedApprovalOverride,
  hasPersistedCampaignApproval,
  requireApprovedCampaignForAdsAction,
} from '@/lib/ads/approval-gates'

describe('Ads approval gates', () => {
  it('requires persisted campaign approval evidence for sensitive actions', () => {
    expect(hasPersistedCampaignApproval({ reviewState: 'approved', approvedAt: { seconds: 1 }, approvedBy: 'client-1' } as any)).toBe(true)
    expect(hasPersistedCampaignApproval({ reviewState: 'approved', approvedBy: 'client-1' } as any)).toBe(false)

    expect(
      requireApprovedCampaignForAdsAction({ id: 'cmp-1', reviewState: 'awaiting' } as any, 'launch'),
    ).toMatch(/blocked until the campaign has persisted approval evidence/i)
    expect(
      requireApprovedCampaignForAdsAction({ id: 'cmp-1', reviewState: 'approved', approvedAt: { seconds: 1 }, approvedBy: 'client-1' } as any, 'launch'),
    ).toBeNull()
  })

  it('detects caller-supplied approval fields so routes cannot trust request-body approval state', () => {
    const path = findUntrustedApprovalOverride({ input: { capCents: 1000, approvalState: 'approved' } })
    expect(path).toBe('body.input.approvalState')
    expect(approvalOverrideErrorMessage(path!)).toMatch(/persisted records/i)
    expect(findUntrustedApprovalOverride({ input: { capCents: 1000, approvalCampaignId: 'cmp-1' } })).toBeNull()
  })
})
