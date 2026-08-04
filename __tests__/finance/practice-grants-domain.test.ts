import type { FinanceActorContext, FinanceRoleAssignment } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  PRACTICE_GRANT_HARD_DENY_ACTIONS,
  authorizePracticeGrantAction,
  grantAllowsAction,
} from '@/lib/finance/practice/grants'
import {
  PracticeFinanceService,
  createEmptyPracticeStore,
  type PracticeFinanceStore,
} from '@/lib/finance/practice/service'

function firmAdmin(overrides: Partial<FinanceActorContext> = {}): FinanceActorContext {
  const uid = overrides.uid ?? 'firm_admin'
  const orgId = overrides.orgId ?? 'firm_a'
  const assignment: FinanceRoleAssignment = {
    id: 'asg_fa',
    orgId,
    userId: uid,
    legalEntityId: 'le_firm',
    scopeMode: 'entity',
    role: 'finance_admin',
    status: 'active',
  }
  return {
    uid,
    orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: overrides.assignments ?? [assignment],
    ...overrides,
  }
}

function granteeOnFirm(uid = 'prep_user'): FinanceActorContext {
  return {
    uid,
    orgId: 'firm_a',
    membershipRole: 'member',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg_prep_firm',
        orgId: 'firm_a',
        userId: uid,
        legalEntityId: 'le_firm',
        scopeMode: 'entity',
        role: 'bookkeeper',
        status: 'active',
      },
    ],
  }
}

function serviceWith(storeRef: { current: PracticeFinanceStore }) {
  return new PracticeFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => '2026-08-03T15:00:00.000Z',
  )
}

describe('practice firm→client grants', () => {
  test('prepare can draft but cannot approve pay run; hard deny holds', () => {
    expect(grantAllowsAction('prepare', 'journal.create')).toBe(true)
    expect(grantAllowsAction('prepare', 'invoice.create')).toBe(true)
    expect(grantAllowsAction('prepare', 'payroll.run.approve')).toBe(false)
    expect(grantAllowsAction('review', 'report.read')).toBe(true)
    expect(grantAllowsAction('review', 'journal.create')).toBe(false)
    expect(grantAllowsAction('file-export', 'payroll.export.generate')).toBe(true)
    expect(grantAllowsAction('file-export', 'payroll.export.approve')).toBe(false)
    for (const action of PRACTICE_GRANT_HARD_DENY_ACTIONS) {
      expect(grantAllowsAction('prepare', action)).toBe(false)
      expect(grantAllowsAction('review', action)).toBe(false)
      expect(grantAllowsAction('file-export', action)).toBe(false)
    }
  })

  test('create prepare grant, access allowed, revoke denies next command, audit present', async () => {
    const storeRef = { current: createEmptyPracticeStore() }
    const svc = serviceWith(storeRef)
    const admin = firmAdmin()

    await svc.upsertClientLink(admin, {
      id: 'link_client_b',
      firmOrgId: 'firm_a',
      clientOrgId: 'client_b',
      clientName: 'Beta Books',
      openPeriodCount: 1,
      closeBlockerCount: 2,
      reconBacklogCount: 0,
      requestId: 'r0',
      idempotencyKey: 'link1',
    })

    const grant = await svc.createGrant(admin, {
      id: 'g_prep_1',
      firmOrgId: 'firm_a',
      clientOrgId: 'client_b',
      granteeUserId: 'prep_user',
      role: 'prepare',
      requestId: 'r1',
      idempotencyKey: 'g1',
    })
    expect(grant.status).toBe('active')
    expect(grant.externalEgressAllowed).toBe(false)
    expect(grant.clientVisibleMessagesAllowed).toBe(false)
    expect(grant.externalPaymentInitiated).toBe(false)
    expect(grant.sarsSubmissionInitiated).toBe(false)

    const prep = granteeOnFirm('prep_user')
    const allowed = await svc.authorizeGrantAccess(prep, {
      firmOrgId: 'firm_a',
      clientOrgId: 'client_b',
      action: 'journal.create',
      legalEntityId: 'le_client',
      resource: 'journal:draft',
      requestId: 'r2',
      idempotencyKey: 'a1',
    })
    expect(allowed.allowed).toBe(true)
    expect(allowed.grant.id).toBe('g_prep_1')

    await expect(
      svc.authorizeGrantAccess(prep, {
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        action: 'payroll.run.approve',
        requestId: 'r3',
        idempotencyKey: 'a2',
      }),
    ).rejects.toThrow(FinanceAuthorizationError)

    const revoked = await svc.revokeGrant(admin, {
      id: 'g_prep_1',
      firmOrgId: 'firm_a',
      reason: 'engagement ended',
      requestId: 'r4',
      idempotencyKey: 'rev1',
    })
    expect(revoked.status).toBe('revoked')

    await expect(
      svc.authorizeGrantAccess(prep, {
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        action: 'journal.create',
        requestId: 'r5',
        idempotencyKey: 'a3',
      }),
    ).rejects.toThrow(/No active practice grant/i)

    const bundle = await svc.getBundle(admin, 'firm_a')
    expect(bundle.grants.some((g) => g.id === 'g_prep_1' && g.status === 'revoked')).toBe(true)
    expect(bundle.grantAccessEvents.some((e) => e.action === 'grant.create')).toBe(true)
    expect(bundle.grantAccessEvents.some((e) => e.action === 'grant.access')).toBe(true)
    expect(bundle.grantAccessEvents.some((e) => e.action === 'grant.denied')).toBe(true)
    expect(bundle.grantAccessEvents.some((e) => e.action === 'grant.revoke')).toBe(true)
    expect(bundle.auditEvents.some((e) => e.eventType === 'practice.grant.created')).toBe(true)
    expect(bundle.auditEvents.some((e) => e.eventType === 'practice.grant.revoked')).toBe(true)
    expect(bundle.safety.clientVisibleMessagesAllowed).toBe(false)
    expect(bundle.safety.externalEgressAllowed).toBe(false)
    expect(bundle.safety.practiceGrantsEnabled).toBe(true)
    expect(bundle.safety.noSarsSubmit).toBe(true)
    expect(bundle.safety.noExternalPaymentInitiate).toBe(true)

    // Practice queue surfaces close blockers first
    expect(bundle.practiceQueue[0]?.clientOrgId).toBe('client_b')
    expect(bundle.practiceQueue[0]?.attention).toBe('close_blocker')
    expect(bundle.practiceQueue[0]?.severity).toBe('high')
  })

  test('tenant isolation: foreign firm grants never appear in firm bundle', async () => {
    const storeRef = { current: createEmptyPracticeStore() }
    storeRef.current.grants.set('foreign', {
      id: 'foreign',
      schemaVersion: 1,
      firmOrgId: 'firm_other',
      clientOrgId: 'client_x',
      granteeUserId: 'spy',
      role: 'review',
      status: 'active',
      createdBy: 'spy',
      createdAt: '2026-08-01T00:00:00.000Z',
      clientVisibleMessagesAllowed: false,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    })
    storeRef.current.clientLinks.set('foreign_link', {
      id: 'foreign_link',
      schemaVersion: 1,
      firmOrgId: 'firm_other',
      clientOrgId: 'client_x',
      clientName: 'Secret',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    const svc = serviceWith(storeRef)
    const admin = firmAdmin()
    await svc.upsertClientLink(admin, {
      id: 'link_own',
      firmOrgId: 'firm_a',
      clientOrgId: 'client_b',
      clientName: 'Beta',
      requestId: 'x1',
      idempotencyKey: 'lown',
    })
    const bundle = await svc.getBundle(admin, 'firm_a')
    expect(bundle.grants.every((g) => g.firmOrgId === 'firm_a')).toBe(true)
    expect(bundle.grants.some((g) => g.id === 'foreign')).toBe(false)
    expect(bundle.clientLinks.every((l) => l.firmOrgId === 'firm_a')).toBe(true)
    expect(bundle.clientLinks.some((l) => l.id === 'foreign_link')).toBe(false)
  })

  test('pure authorize requires firm actor org and active grant', () => {
    const grants = [
      {
        id: 'g1',
        schemaVersion: 1 as const,
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        granteeUserId: 'prep_user',
        role: 'prepare' as const,
        status: 'active' as const,
        createdBy: 'admin',
        createdAt: '2026-08-03T00:00:00.000Z',
        clientVisibleMessagesAllowed: false as const,
        externalEgressAllowed: false as const,
        externalPaymentInitiated: false as const,
        sarsSubmissionInitiated: false as const,
      },
    ]
    const prep = granteeOnFirm('prep_user')
    expect(
      authorizePracticeGrantAction({
        actor: prep,
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        action: 'bank.import',
        grants,
      }).id,
    ).toBe('g1')

    expect(() =>
      authorizePracticeGrantAction({
        actor: { ...prep, orgId: 'client_b' },
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        action: 'bank.import',
        grants,
      }),
    ).toThrow(/practice firm scope/i)

    expect(() =>
      authorizePracticeGrantAction({
        actor: prep,
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        action: 'period.close',
        grants,
      }),
    ).toThrow(/cannot perform period.close/i)
  })

  test('grant create requires client link; bookkeeper cannot manage grants', async () => {
    const storeRef = { current: createEmptyPracticeStore() }
    const svc = serviceWith(storeRef)
    const admin = firmAdmin()
    await expect(
      svc.createGrant(admin, {
        id: 'g_fail',
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        granteeUserId: 'u',
        role: 'review',
        requestId: 'r',
        idempotencyKey: 'f1',
      }),
    ).rejects.toThrow(/link required/i)

    await svc.upsertClientLink(admin, {
      id: 'link1',
      firmOrgId: 'firm_a',
      clientOrgId: 'client_b',
      clientName: 'Beta',
      requestId: 'r2',
      idempotencyKey: 'l1',
    })

    const bk = firmAdmin({
      uid: 'bk',
      membershipRole: 'member',
      assignments: [
        {
          id: 'asg_bk',
          orgId: 'firm_a',
          userId: 'bk',
          legalEntityId: 'le_firm',
          scopeMode: 'entity',
          role: 'bookkeeper',
          status: 'active',
        },
      ],
    })
    await expect(
      svc.createGrant(bk, {
        id: 'g_bk',
        firmOrgId: 'firm_a',
        clientOrgId: 'client_b',
        granteeUserId: 'u',
        role: 'prepare',
        requestId: 'r3',
        idempotencyKey: 'bk1',
      }),
    ).rejects.toThrow(/owner or admin|finance_admin/i)
  })
})
