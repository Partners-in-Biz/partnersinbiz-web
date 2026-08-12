import type { MemberRef } from '@/lib/orgMembers/memberRef'
import {
  identityLinkKey,
  planIdentityBackfill,
  planIdentityLinksForAcceptance,
  planPointerSyncForCompany,
  planPointerSyncForContact,
  pickPrimaryTarget,
  validateIdentityLinkShape,
  type IdentityLinkCandidate,
  type PointerSourceLink,
} from '@/lib/cross-org/identity'
import type { PartnerIdentityLink } from '@/lib/cross-org/types'

const actor: MemberRef = { uid: 'user:admin-1', displayName: 'Admin One', kind: 'human' }

function candidateKey(candidate: IdentityLinkCandidate): string {
  return identityLinkKey({
    linkType: candidate.linkType,
    sourceRef: candidate.sourceRef,
    targetRef: candidate.targetRef,
  })
}

describe('identityLinkKey / validateIdentityLinkShape', () => {
  it('builds a stable dedupe key', () => {
    const key = identityLinkKey({
      linkType: 'company_org',
      sourceRef: { kind: 'company', id: 'company-1' },
      targetRef: { kind: 'org', id: 'org-b' },
    })
    expect(key).toBe('company_org:company:company-1:org:org-b')
  })

  it('accepts the four linkType shapes', () => {
    expect(validateIdentityLinkShape({
      linkType: 'company_org',
      sourceRef: { kind: 'company', id: 'c' },
      targetRef: { kind: 'org', id: 'o' },
    })).toBeNull()
    expect(validateIdentityLinkShape({
      linkType: 'contact_user',
      sourceRef: { kind: 'contact', id: 'ct' },
      targetRef: { kind: 'user', id: 'u' },
    })).toBeNull()
    expect(validateIdentityLinkShape({
      linkType: 'company_user',
      sourceRef: { kind: 'company', id: 'c' },
      targetRef: { kind: 'user', id: 'u' },
    })).toBeNull()
    expect(validateIdentityLinkShape({
      linkType: 'contact_org',
      sourceRef: { kind: 'contact', id: 'ct' },
      targetRef: { kind: 'org', id: 'o' },
    })).toBeNull()
  })

  it('rejects refs that do not match the linkType shape', () => {
    expect(validateIdentityLinkShape({
      linkType: 'company_org',
      sourceRef: { kind: 'contact', id: 'ct' },
      targetRef: { kind: 'org', id: 'o' },
    })).toContain('company_org')
    expect(validateIdentityLinkShape({
      linkType: 'contact_user',
      sourceRef: { kind: 'company', id: 'c' },
      targetRef: { kind: 'org', id: 'o' },
    })).toContain('contact_user')
  })
})

describe('planIdentityLinksForAcceptance', () => {
  const base = {
    partnerLinkId: 'link-1',
    sourceInviteId: 'invite-1',
    sourceOrgId: 'org-a',
    sourceCompanyId: 'company-a',
    sourceContactId: 'contact-a',
    targetUserId: 'user:bea',
    targetOrgId: 'org-b',
    targetCompanyId: 'company-b',
    targetContactId: 'contact-b',
    inviterUserId: 'user:alpha-boss',
    actorRef: actor,
  }

  it('plans both sides when the recipient identity matched', () => {
    const plan = planIdentityLinksForAcceptance(base)
    const keys = plan.map(candidateKey).sort()
    expect(keys).toEqual([
      'company_org:company:company-a:org:org-b',
      'company_org:company:company-b:org:org-a',
      'contact_org:contact:contact-a:org:org-b',
      'contact_org:contact:contact-b:org:org-a',
      'contact_user:contact:contact-a:user:user:bea',
      'contact_user:contact:contact-b:user:user:alpha-boss',
    ])
    // Org-level links are verified by the acceptor (the approver).
    for (const link of plan.filter((c) => c.linkType === 'company_org' || c.linkType === 'contact_org')) {
      expect(link.status).toBe('verified')
      expect(link.verifiedByRef?.uid).toBe('user:admin-1')
      expect(link.partnerLinkId).toBe('link-1')
      expect(link.provenance.sourceInviteId).toBe('invite-1')
    }
    // The recipient contact_user is verified; the inviter-side one is recorded
    // but UNVERIFIED (the acceptor approved the org, not the inviter's user).
    const recipientLink = plan.find((c) => c.targetRef.kind === 'user' && c.targetRef.id === 'user:bea')
    const inviterLink = plan.find((c) => c.targetRef.kind === 'user' && c.targetRef.id === 'user:alpha-boss')
    expect(recipientLink?.status).toBe('verified')
    expect(inviterLink?.status).toBe('unverified')
  })

  it('NEVER creates a contact_user link for the approver when an owner/admin accepts on behalf', () => {
    const plan = planIdentityLinksForAcceptance({
      ...base,
      // The approver is a different admin; the recipient identity is absent.
      targetUserId: undefined,
      actorRef: { uid: 'user:admin-2', displayName: 'Admin Two', kind: 'human' },
    })
    const userTargets = plan.filter((c) => c.targetRef.kind === 'user')
    // Only the inviter-side recorded (unverified) link may target a user.
    expect(userTargets.map((c) => c.targetRef.id)).toEqual(['user:alpha-boss'])
    expect(userTargets[0].status).toBe('unverified')
    expect(userTargets[0].verifiedByRef).toBeUndefined()
    // Org-level links are still verified by the approving admin.
    const orgLinks = plan.filter((c) => c.targetRef.kind === 'org')
    expect(orgLinks.length).toBe(4)
    expect(orgLinks.every((c) => c.status === 'verified')).toBe(true)
    expect(orgLinks.every((c) => c.verifiedByRef?.uid === 'user:admin-2')).toBe(true)
  })

  it('keeps working when no source contact exists yet', () => {
    const plan = planIdentityLinksForAcceptance({ ...base, sourceContactId: undefined })
    const keys = plan.map(candidateKey)
    expect(keys.some((k) => k.includes('contact:contact-a:'))).toBe(false)
    expect(keys).toContain('company_org:company:company-a:org:org-b')
  })
})

describe('pickPrimaryTarget / pointer sync plans', () => {
  const link = (partial: {
    linkType: 'company_org' | 'contact_org' | 'contact_user'
    targetId: string
    status: 'verified' | 'unverified' | 'revoked'
    verifiedAt?: number
    createdAt?: number
  }): PointerSourceLink => ({
    linkType: partial.linkType,
    status: partial.status,
    targetRef: {
      kind: (partial.linkType === 'contact_user' ? 'user' : 'org') as 'org' | 'user',
      id: partial.targetId,
    },
    verifiedAt: partial.verifiedAt !== undefined
      ? { toMillis: () => partial.verifiedAt as number }
      : undefined,
    createdAt: partial.createdAt !== undefined
      ? { toMillis: () => partial.createdAt as number }
      : undefined,
  })

  it('picks the earliest verified link as primary', () => {
    const links = [
      link({ linkType: 'company_org', targetId: 'org-b', status: 'verified', verifiedAt: 2000 }),
      link({ linkType: 'company_org', targetId: 'org-c', status: 'verified', verifiedAt: 1000 }),
    ]
    expect(pickPrimaryTarget(links, 'company_org')).toBe('org-c')
    expect(planPointerSyncForCompany(links).linkedOrgId).toBe('org-c')
  })

  it('falls back to unverified when nothing is verified yet (backfill)', () => {
    const links = [
      link({ linkType: 'company_org', targetId: 'org-b', status: 'unverified', createdAt: 500 }),
      link({ linkType: 'company_org', targetId: 'org-c', status: 'unverified', createdAt: 100 }),
    ]
    expect(planPointerSyncForCompany(links).linkedOrgId).toBe('org-c')
  })

  it('excludes revoked links and lets the next primary take over', () => {
    const links = [
      link({ linkType: 'company_org', targetId: 'org-b', status: 'revoked', verifiedAt: 100 }),
      link({ linkType: 'company_org', targetId: 'org-c', status: 'verified', verifiedAt: 200 }),
    ]
    expect(planPointerSyncForCompany(links).linkedOrgId).toBe('org-c')
  })

  it('returns null pointers when no active link exists (unlink clears primary)', () => {
    const links = [link({ linkType: 'company_org', targetId: 'org-b', status: 'revoked', verifiedAt: 100 })]
    expect(planPointerSyncForCompany(links).linkedOrgId).toBeNull()
  })

  it('derives both contact pointers (multi-client contact)', () => {
    const links = [
      link({ linkType: 'contact_org', targetId: 'org-b', status: 'verified', verifiedAt: 100 }),
      link({ linkType: 'contact_org', targetId: 'org-c', status: 'verified', verifiedAt: 50 }),
      link({ linkType: 'contact_user', targetId: 'user:bob', status: 'verified', verifiedAt: 100 }),
      link({ linkType: 'contact_user', targetId: 'user:carol', status: 'verified', verifiedAt: 50 }),
    ]
    expect(planPointerSyncForContact(links)).toEqual({
      linkedOrgId: 'org-c',
      linkedUserId: 'user:carol',
    })
  })
})

describe('planIdentityBackfill', () => {
  const existing = (partial: Partial<PartnerIdentityLink>): PartnerIdentityLink => ({
    id: 'existing-1',
    linkType: 'company_org',
    sourceRef: { kind: 'company', id: 'company-1' },
    targetRef: { kind: 'org', id: 'org-b' },
    status: 'verified',
    provenance: {},
    schemaVersion: 1,
    createdAt: { toMillis: () => 1000 },
    updatedAt: { toMillis: () => 1000 },
    ...partial,
  })

  it('plans unverified rows for legacy pointers without duplicating existing links', () => {
    const plan = planIdentityBackfill({
      companyId: 'company-1',
      contactId: 'contact-1',
      pointers: { linkedOrgId: 'org-b', linkedUserId: 'user-b' },
      existing: [
        // company-1 -> org-b already canonical; contact-1 -> user-b is new.
        existing({}),
      ],
    })
    const keys = plan.map(candidateKey)
    // company_org:company-1->org-b is skipped (already exists); the contact
    // rows are new and start unverified.
    expect(keys).toEqual([
      'contact_user:contact:contact-1:user:user-b',
      'contact_org:contact:contact-1:org:org-b',
    ])
    expect(plan.every((c) => c.status === 'unverified')).toBe(true)
  })

  it('never re-creates a revoked row (revocation is permanent)', () => {
    const plan = planIdentityBackfill({
      companyId: 'company-1',
      pointers: { linkedOrgId: 'org-b' },
      existing: [existing({ status: 'revoked' })],
    })
    expect(plan).toEqual([])
  })

  it('supports many-to-many backfill (holding company pointing at several orgs is re-derived from the pointer set)', () => {
    const plan = planIdentityBackfill({
      companyId: 'company-hold',
      contactId: 'contact-hold',
      pointers: { linkedOrgId: 'org-sub-1', linkedUserId: 'user-shared' },
      existing: [],
    })
    expect(plan.map(candidateKey).sort()).toEqual([
      'company_org:company:company-hold:org:org-sub-1',
      'contact_org:contact:contact-hold:org:org-sub-1',
      'contact_user:contact:contact-hold:user:user-shared',
    ])
  })

  it('does nothing when no pointers exist', () => {
    const plan = planIdentityBackfill({ companyId: 'company-1', pointers: {}, existing: [] })
    expect(plan).toEqual([])
  })
})
