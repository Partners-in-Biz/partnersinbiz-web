import {
  routeReplyToSales,
  type ReplyRoutingDependencies,
  type ReplyRoutingInput,
} from '@/lib/email-marketing/reply-routing'

const baseInput: ReplyRoutingInput = {
  inboundId: 'inbound-1',
  inboundOrgId: '',
  outboundEmailId: 'email-1',
  outbound: {
    orgId: 'org-1',
    contactId: 'contact-1',
    senderOwnerUid: 'sales-1',
    campaignId: 'campaign-1',
    sequenceId: 'sequence-1',
    broadcastId: '',
    variantId: 'variant-a',
    stopOnReply: true,
  },
  subject: 'Re: proposal',
  bodyText: 'Yes, please book a call.',
  fromEmail: 'buyer@example.com',
  receivedAt: new Date('2026-07-12T12:00:00Z'),
}

function deps(overrides: Partial<ReplyRoutingDependencies> = {}): ReplyRoutingDependencies {
  return {
    getMember: jest.fn(async (_orgId, uid) => ({ uid, active: true })),
    getContact: jest.fn(async () => ({ id: 'contact-1', orgId: 'org-1', name: 'Buyer', email: 'buyer@example.com' })),
    getFallback: jest.fn(async () => ({ userId: 'fallback-1', queueId: 'sales-queue', slaMinutes: 60 })),
    persist: jest.fn(async (record) => ({ ...record, created: true })),
    ...overrides,
  }
}

describe('reply-to-sales routing', () => {
  it('routes to the snapshotted salesperson before any fallback', async () => {
    const d = deps()
    const result = await routeReplyToSales(baseInput, d)

    expect(result.ownerUserId).toBe('sales-1')
    expect(result.resolutionSource).toBe('sender_snapshot')
    expect(result.queueId).toBeNull()
    expect(d.getFallback).not.toHaveBeenCalled()
    expect(d.persist).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'org-1:inbound-1',
      orgId: 'org-1',
      ownerUserId: 'sales-1',
      campaignId: 'campaign-1',
      sequenceId: 'sequence-1',
      salespersonUid: 'sales-1',
      slaDueAt: expect.objectContaining({ toMillis: expect.any(Function) }),
      escalationState: 'not_due',
      escalationPath: ['user:sales-1', 'organisation_fallback'],
    }))
    const persisted = (d.persist as jest.Mock).mock.calls[0][0]
    expect(persisted.slaDueAt.toMillis()).toBe(new Date('2026-07-12T13:00:00Z').getTime())
  })

  it('uses the explicit same-org fallback when the snapshotted salesperson is inactive', async () => {
    const d = deps({
      getMember: jest.fn(async (_orgId, uid) => ({ uid, active: uid === 'fallback-1' })),
    })
    const result = await routeReplyToSales(baseInput, d)

    expect(result.ownerUserId).toBe('fallback-1')
    expect(result.queueId).toBe('sales-queue')
    expect(result.resolutionSource).toBe('fallback_user')
    expect(result.fallbackReason).toBe('snapshotted_owner_inactive')
  })

  it('falls back to an explicit queue when no active fallback member exists', async () => {
    const d = deps({
      getMember: jest.fn(async (_orgId, uid) => ({ uid, active: false })),
    })
    const result = await routeReplyToSales(baseInput, d)

    expect(result.ownerUserId).toBeNull()
    expect(result.queueId).toBe('sales-queue')
    expect(result.resolutionSource).toBe('fallback_queue')
  })

  it('rejects conflicting inbound and outbound organisation lineage', async () => {
    const d = deps()
    await expect(routeReplyToSales({ ...baseInput, inboundOrgId: 'org-2' }, d)).rejects.toThrow('organisation mismatch')
    expect(d.persist).not.toHaveBeenCalled()
  })

  it('rejects a contact that does not belong to the outbound organisation', async () => {
    const d = deps({
      getContact: jest.fn(async () => ({ id: 'contact-1', orgId: 'org-2', name: 'Wrong tenant', email: 'buyer@example.com' })),
    })
    await expect(routeReplyToSales(baseInput, d)).rejects.toThrow('Contact does not belong')
    expect(d.persist).not.toHaveBeenCalled()
  })

  it('returns the persisted route on replay instead of creating duplicate CRM handoff records', async () => {
    const persisted = {
      idempotencyKey: 'org-1:inbound-1',
      orgId: 'org-1',
      inboundId: 'inbound-1',
      outboundEmailId: 'email-1',
      contactId: 'contact-1',
      ownerUserId: 'sales-1',
      queueId: null,
      resolutionSource: 'sender_snapshot' as const,
      fallbackReason: null,
      campaignId: 'campaign-1',
      sequenceId: 'sequence-1',
      broadcastId: '',
      programId: '',
      variantId: 'variant-a',
      salespersonUid: 'sales-1',
      stopOnReply: true,
      subject: 'Re: proposal',
      bodyText: 'Yes, please book a call.',
      fromEmail: 'buyer@example.com',
      receivedAt: baseInput.receivedAt,
      slaMinutes: 60,
      created: false,
    }
    const d = deps({ persist: jest.fn(async () => persisted) })

    const result = await routeReplyToSales(baseInput, d)
    expect(result).toEqual(persisted)
    expect(result.created).toBe(false)
  })
})
