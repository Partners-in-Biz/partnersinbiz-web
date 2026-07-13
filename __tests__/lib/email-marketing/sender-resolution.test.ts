import { resolveSenderForRecipient } from '@/lib/email-marketing/sender-resolution'
import type {
  EmailSenderIdentity,
  EmailSenderPolicy,
  SenderResolutionDependencies,
  SenderResolutionInput,
} from '@/lib/email-marketing/sender-types'

const orgId = 'org-1'

function identity(overrides: Partial<EmailSenderIdentity> = {}): EmailSenderIdentity {
  return {
    id: 'identity-default',
    orgId,
    displayName: 'Marketing',
    emailAddress: 'marketing@example.test',
    localPart: 'marketing',
    ownerUid: null,
    domainId: 'domain-1',
    mailboxAccountId: null,
    mode: 'esp_domain',
    purposes: ['marketing_bulk', 'lifecycle', 'sales_1to1', 'transactional'],
    verificationStatus: 'verified',
    enabled: true,
    isDefault: true,
    delegatedActorUids: [],
    healthStatus: 'healthy',
    quota: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function policy(overrides: Partial<EmailSenderPolicy> = {}): EmailSenderPolicy {
  return {
    id: 'policy-1',
    orgId,
    name: 'Default policy',
    strategy: 'organisation_default',
    purpose: 'marketing_bulk',
    defaultIdentityId: 'identity-default',
    fixedIdentityId: null,
    fallbackIdentityId: null,
    roundRobinIdentityIds: [],
    noOwnerBehavior: 'exclude',
    allowConnectedMailbox: false,
    connectedMailboxMaxRecipients: 1,
    enabled: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function input(overrides: Partial<SenderResolutionInput> = {}): SenderResolutionInput {
  return {
    orgId,
    actorUid: 'marketer-1',
    campaignCreatorUid: 'marketer-1',
    policy: policy(),
    recipient: { contactId: 'contact-1', contactOwnerUid: 'sales-1' },
    batchSize: 100,
    ...overrides,
  }
}

function dependencies(identities: EmailSenderIdentity[], overrides: Partial<SenderResolutionDependencies> = {}): SenderResolutionDependencies {
  return {
    listIdentities: async () => identities,
    getDomain: async (_id) => ({ orgId, status: 'verified', deleted: false }),
    getMailbox: async (_id) => null,
    getMember: async (_uid) => ({ orgId, role: 'member', status: 'active', disabled: false }),
    ...overrides,
  }
}

describe('resolveSenderForRecipient', () => {
  it('resolves the organisation default through an authenticated ESP domain', async () => {
    const result = await resolveSenderForRecipient(input(), dependencies([identity()]))

    expect(result.status).toBe('resolved')
    expect(result.identity?.id).toBe('identity-default')
    expect(result.resolutionSource).toBe('organisation_default')
    expect(result.ownerUid).toBeNull()
  })

  it.each([
    ['contact_owner', { contactOwnerUid: 'sales-1' }],
    ['company_account_manager', { companyAccountManagerUid: 'sales-1' }],
    ['deal_owner', { dealOwnerUid: 'sales-1' }],
  ] as const)('resolves %s to the matching salesperson identity', async (strategy, recipient) => {
    const salesperson = identity({ id: 'sales-identity', ownerUid: 'sales-1', isDefault: false })
    const result = await resolveSenderForRecipient(
      input({ policy: policy({ strategy }), recipient: { contactId: 'contact-1', ...recipient } }),
      dependencies([salesperson]),
    )

    expect(result.status).toBe('resolved')
    expect(result.identity?.id).toBe('sales-identity')
    expect(result.ownerUid).toBe('sales-1')
  })

  it('uses deterministic round robin assignment independent of identity input order', async () => {
    const identities = [
      identity({ id: 'pool-a', isDefault: false }),
      identity({ id: 'pool-b', isDefault: false }),
      identity({ id: 'pool-c', isDefault: false }),
    ]
    const rrPolicy = policy({
      strategy: 'round_robin_pool',
      roundRobinIdentityIds: ['pool-c', 'pool-a', 'pool-b'],
    })
    const first = await resolveSenderForRecipient(input({ policy: rrPolicy }), dependencies(identities))
    const second = await resolveSenderForRecipient(input({ policy: rrPolicy }), dependencies([...identities].reverse()))

    expect(first.status).toBe('resolved')
    expect(second.identity?.id).toBe(first.identity?.id)
  })

  it.each([
    ['exclude', 'excluded'],
    ['block', 'blocked'],
  ] as const)('applies %s when an owner is missing', async (noOwnerBehavior, status) => {
    const result = await resolveSenderForRecipient(
      input({
        policy: policy({ strategy: 'contact_owner', noOwnerBehavior }),
        recipient: { contactId: 'contact-1' },
      }),
      dependencies([identity()]),
    )

    expect(result.status).toBe(status)
    expect(result.reason).toBe('no_contact_owner')
  })

  it('uses only an approved fallback when an owner has no eligible identity', async () => {
    const fallback = identity({ id: 'fallback', isDefault: false })
    const result = await resolveSenderForRecipient(
      input({ policy: policy({ strategy: 'contact_owner', noOwnerBehavior: 'fallback', fallbackIdentityId: 'fallback' }) }),
      dependencies([fallback]),
    )

    expect(result.status).toBe('resolved')
    expect(result.identity?.id).toBe('fallback')
    expect(result.fallbackReason).toBe('owner_identity_unavailable')
  })

  it('rejects cross-org, disabled-member, unverified-domain, disabled, unhealthy, and over-quota identities', async () => {
    const candidates = [
      identity({ id: 'cross-org', orgId: 'org-2' }),
      identity({ id: 'disabled', enabled: false }),
      identity({ id: 'unhealthy', healthStatus: 'blocked' }),
      identity({ id: 'quota', quota: { dailyLimit: 10, sentToday: 10 } }),
      identity({ id: 'domain', domainId: 'unverified-domain' }),
      identity({ id: 'member', ownerUid: 'disabled-member' }),
    ]
    const deps = dependencies(candidates, {
      getDomain: async (id) => ({ orgId, status: id === 'unverified-domain' ? 'pending' : 'verified', deleted: false }),
      getMember: async (uid) => ({ orgId, role: 'member', status: uid === 'disabled-member' ? 'disabled' : 'active', disabled: uid === 'disabled-member' }),
    })

    for (const candidate of candidates) {
      const result = await resolveSenderForRecipient(
        input({ policy: policy({ strategy: 'fixed_identity', fixedIdentityId: candidate.id, noOwnerBehavior: 'block' }) }),
        deps,
      )
      expect(result.status).toBe('blocked')
      expect(result.reason).toMatch(/identity_/)
    }
  })

  it('never uses a connected mailbox for bulk and permits an authorised mailbox only for low-volume sales 1:1', async () => {
    const mailbox = identity({
      id: 'mailbox',
      ownerUid: 'sales-1',
      domainId: null,
      mailboxAccountId: 'mailbox-1',
      mode: 'connected_mailbox',
      purposes: ['sales_1to1'],
      delegatedActorUids: ['marketer-1'],
    })
    const mailboxDeps = dependencies([mailbox], {
      getMailbox: async () => ({ orgId, uid: 'sales-1', status: 'connected', emailAddress: mailbox.emailAddress }),
    })

    const bulk = await resolveSenderForRecipient(
      input({ policy: policy({ strategy: 'fixed_identity', fixedIdentityId: 'mailbox', allowConnectedMailbox: true, noOwnerBehavior: 'block' }) }),
      mailboxDeps,
    )
    expect(bulk.status).toBe('blocked')
    expect(bulk.reason).toBe('identity_purpose_not_allowed')

    const oneToOne = await resolveSenderForRecipient(
      input({
        batchSize: 1,
        policy: policy({
          strategy: 'fixed_identity',
          purpose: 'sales_1to1',
          fixedIdentityId: 'mailbox',
          allowConnectedMailbox: true,
          noOwnerBehavior: 'block',
        }),
      }),
      mailboxDeps,
    )
    expect(oneToOne.status).toBe('resolved')
  })

  it('requires same-org active membership and delegation for a salesperson identity', async () => {
    const salesperson = identity({ id: 'sales', ownerUid: 'sales-1', delegatedActorUids: ['manager-1'] })
    const noDelegation = await resolveSenderForRecipient(
      input({ actorUid: 'marketer-1', policy: policy({ strategy: 'fixed_identity', fixedIdentityId: 'sales', noOwnerBehavior: 'block' }) }),
      dependencies([salesperson]),
    )
    expect(noDelegation.reason).toBe('identity_not_delegated')

    const delegated = await resolveSenderForRecipient(
      input({ actorUid: 'manager-1', policy: policy({ strategy: 'fixed_identity', fixedIdentityId: 'sales', noOwnerBehavior: 'block' }) }),
      dependencies([salesperson]),
    )
    expect(delegated.status).toBe('resolved')
  })
})
