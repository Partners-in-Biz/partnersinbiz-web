import {
  memberCanIssueInvoices,
  memberCanIssueQuotes,
  normalizeMemberAccessPolicy,
  FULL_ACCESS_POLICY,
} from '@/lib/orgMembers/access-policy'
import {
  actorHasIssuerGrant,
  shouldExposeIssuerBillingBook,
  crmActorCanIssueForTarget,
  memberCanDeleteBilling,
  memberCanPerformBillingAction,
  resolveQuoteCreateAccess,
} from '@/lib/billing/member-issuer'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

const mockCompanyGet = jest.fn()
const mockContactGet = jest.fn()
const mockContactWhere = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'companies') {
        return { doc: (id: string) => ({ get: () => mockCompanyGet(id) }) }
      }
      if (name === 'contacts') {
        return {
          doc: (id: string) => ({ get: () => mockContactGet(id) }),
          where: (...args: unknown[]) => {
            mockContactWhere(...args)
            return {
              limit: () => ({
                get: async () => ({ docs: [] }),
              }),
            }
          },
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

function memberCtx(overrides: Partial<CrmAuthContext> = {}): CrmAuthContext {
  return {
    orgId: 'pib-platform-owner',
    uid: 'stean',
    actor: { uid: 'stean', displayName: 'Stean', kind: 'human' },
    role: 'member',
    isAgent: false,
    permissions: {},
    accessPolicy: normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { crm: true, billing: true, reports: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      capabilities: { invoices: true, quotes: true },
    }),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCompanyGet.mockImplementation(async (id: string) => {
    if (id === 'co-owned') {
      return { exists: true, data: () => ({ orgId: 'pib-platform-owner', ownerUid: 'stean', name: 'Owned Co' }) }
    }
    if (id === 'co-other') {
      return { exists: true, data: () => ({ orgId: 'pib-platform-owner', ownerUid: 'other', name: 'Other Co' }) }
    }
    return { exists: false }
  })
  mockContactGet.mockResolvedValue({ exists: false })
})

describe('member billing issuer capabilities', () => {
  it('does not treat modules.billing alone as issuer grant', () => {
    const policy = normalizeMemberAccessPolicy({
      modules: { billing: true, crm: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
    expect(memberCanIssueInvoices(policy)).toBe(false)
    expect(memberCanIssueQuotes(policy)).toBe(false)
    expect(policy.capabilities).toEqual({ invoices: false, quotes: false })
  })

  it('honors explicit invoice/quote capabilities', () => {
    const policy = normalizeMemberAccessPolicy({
      modules: { billing: true, crm: true },
      capabilities: { invoices: true, quotes: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
    expect(memberCanIssueInvoices(policy)).toBe(true)
    expect(memberCanIssueQuotes(policy)).toBe(true)
  })

  it('full workspace access implies issuer rights', () => {
    expect(memberCanIssueInvoices(FULL_ACCESS_POLICY)).toBe(true)
    expect(memberCanIssueQuotes(FULL_ACCESS_POLICY)).toBe(true)
  })

  it('hides issuer book without grant and shows with grant', () => {
    const noGrant = memberCtx({
      accessPolicy: normalizeMemberAccessPolicy({
        modules: { billing: true, crm: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    })
    const withGrant = memberCtx()
    expect(shouldExposeIssuerBillingBook(noGrant, 'invoices')).toBe(false)
    expect(shouldExposeIssuerBillingBook(withGrant, 'invoices')).toBe(true)
    expect(actorHasIssuerGrant(withGrant, 'quotes')).toBe(true)
    expect(shouldExposeIssuerBillingBook({ ...withGrant, role: 'owner' }, 'invoices')).toBe(true)
  })

  it('allows issue only for owned CRM companies', async () => {
    const ctx = memberCtx()
    await expect(
      crmActorCanIssueForTarget(ctx, {
        companyId: 'co-owned',
        company: { orgId: 'pib-platform-owner', ownerUid: 'stean' },
      }),
    ).resolves.toBe(true)
    await expect(
      crmActorCanIssueForTarget(ctx, {
        companyId: 'co-other',
        company: { orgId: 'pib-platform-owner', ownerUid: 'other' },
      }),
    ).resolves.toBe(false)
  })

  it('denies quote create without grant', async () => {
    const ctx = memberCtx({
      accessPolicy: normalizeMemberAccessPolicy({
        modules: { billing: true, crm: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    })
    await expect(
      resolveQuoteCreateAccess({ ctx, companyId: 'co-owned', company: { ownerUid: 'stean', orgId: ctx.orgId } }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Quote issuer rights are not granted for this member',
    })
  })

  it('denies quote create for other staff client even with grant', async () => {
    const ctx = memberCtx()
    await expect(
      resolveQuoteCreateAccess({
        ctx,
        companyId: 'co-other',
        company: { ownerUid: 'other', orgId: ctx.orgId },
      }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'CRM client is outside this member owned or linked scope',
    })
  })

  it('allows quote create for owned client with grant', async () => {
    const ctx = memberCtx()
    await expect(
      resolveQuoteCreateAccess({
        ctx,
        companyId: 'co-owned',
        company: { ownerUid: 'stean', orgId: ctx.orgId },
      }),
    ).resolves.toEqual({ ok: true, mode: 'member_owned' })
  })

  it('keeps org owner path open without CRM target', async () => {
    const ctx = memberCtx({ role: 'owner', accessPolicy: FULL_ACCESS_POLICY })
    await expect(resolveQuoteCreateAccess({ ctx })).resolves.toEqual({ ok: true, mode: 'org_manager' })
  })

  it('allows billing edit/send by default and refines with explicit member flags', () => {
    const defaultMember = memberCtx()
    const restrictedMember = memberCtx({
      accessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { billing: true, crm: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        moduleActions: { billing: { edit: false, send: false } },
      }),
    })

    // Module on + no explicit flag = current behaviour (allowed).
    expect(memberCanPerformBillingAction(defaultMember, 'edit')).toBe(true)
    expect(memberCanPerformBillingAction(defaultMember, 'send')).toBe(true)
    // Explicit member flag refines.
    expect(memberCanPerformBillingAction(restrictedMember, 'edit')).toBe(false)
    expect(memberCanPerformBillingAction(restrictedMember, 'send')).toBe(false)
    // Owners/admin bypass regardless of flags.
    expect(memberCanPerformBillingAction({ ...defaultMember, role: 'owner' }, 'edit')).toBe(true)
  })

  it('keeps billing delete fail-closed for members and open for managers', () => {
    const noGrant = memberCtx()
    const withGrant = memberCtx({
      accessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { billing: true, crm: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        moduleActions: { billing: { delete: true } },
      }),
    })

    expect(memberCanDeleteBilling(noGrant)).toBe(false)
    expect(memberCanDeleteBilling(withGrant)).toBe(true)
    expect(memberCanDeleteBilling({ ...noGrant, role: 'owner' })).toBe(true)
    expect(memberCanDeleteBilling({ ...noGrant, isAgent: true })).toBe(true)
  })
})
