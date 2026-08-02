import type { FinanceActorContext, FinanceRole, FinanceRoleAssignment } from '@/lib/finance/types'
import { authorizeFinanceAction, FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  PracticeFinanceService,
  buildFinanceRoleMatrix,
  buildPracticeClientSummaries,
  createEmptyPracticeStore,
  filterAuditEventsForQuery,
  type PracticeFinanceStore,
} from '@/lib/finance/practice/service'

function baseActor(overrides: Partial<FinanceActorContext> & { role?: FinanceRole } = {}): FinanceActorContext {
  const role = overrides.role ?? 'finance_admin'
  const uid = overrides.uid ?? 'user_admin'
  const orgId = overrides.orgId ?? 'org_a'
  const assignment: FinanceRoleAssignment = {
    id: 'asg_self',
    orgId,
    userId: uid,
    legalEntityId: 'le_a',
    scopeMode: 'entity',
    role,
    status: 'active',
  }
  return {
    uid,
    orgId,
    membershipRole: overrides.membershipRole ?? 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: overrides.assignments ?? [assignment],
    ...overrides,
  }
}

function serviceWith(storeRef: { current: PracticeFinanceStore }) {
  return new PracticeFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T12:00:00.000Z',
  )
}

describe('finance practice domain', () => {
  test('role matrix includes practice and payroll approve actions', () => {
    const matrix = buildFinanceRoleMatrix()
    expect(matrix.length).toBeGreaterThanOrEqual(40)
    const payApprove = matrix.find((row) => row.action === 'payroll.run.approve')
    expect(payApprove?.roles).toEqual(expect.arrayContaining(['finance_admin', 'payroll_approver']))
    expect(payApprove?.roles).not.toEqual(expect.arrayContaining(['bookkeeper']))
    expect(matrix.some((row) => row.action === 'role.assign')).toBe(true)
    expect(matrix.some((row) => row.action === 'audit.read')).toBe(true)
  })

  test('bookkeeper cannot approve pay run (policy acceptance)', () => {
    const bookkeeper = baseActor({
      uid: 'bk',
      role: 'bookkeeper',
      membershipRole: 'member',
      assignments: [{
        id: 'asg_bk',
        orgId: 'org_a',
        userId: 'bk',
        legalEntityId: 'le_a',
        scopeMode: 'entity',
        role: 'bookkeeper',
        status: 'active',
      }],
    })
    expect(() => authorizeFinanceAction(bookkeeper, { orgId: 'org_a', legalEntityId: 'le_a' }, 'payroll.run.approve'))
      .toThrow(FinanceAuthorizationError)
    expect(() => authorizeFinanceAction(bookkeeper, { orgId: 'org_a', legalEntityId: 'le_a' }, 'role.assign'))
      .toThrow(FinanceAuthorizationError)
  })

  test('tenant isolation: assignments, audit, notifications never leak across orgId', async () => {
    const storeRef = { current: createEmptyPracticeStore() }
    storeRef.current.memberships.set('org_a_user_admin', {
      orgId: 'org_a',
      orgName: 'Alpha Practice',
      userId: 'user_admin',
      role: 'admin',
      active: true,
      financeModuleEnabled: true,
    })
    storeRef.current.memberships.set('org_b_user_admin', {
      orgId: 'org_b',
      orgName: 'Beta Client',
      userId: 'user_admin',
      role: 'member',
      active: true,
      financeModuleEnabled: true,
    })
    // Seed a foreign-org assignment that must never appear in org_a bundle.
    storeRef.current.assignments.set('foreign', {
      id: 'foreign',
      orgId: 'org_b',
      userId: 'other_user',
      legalEntityId: 'le_b',
      scopeMode: 'entity',
      role: 'accountant',
      status: 'active',
    })
    storeRef.current.auditEvents.set('aud_b', {
      id: 'aud_b',
      schemaVersion: 1,
      orgId: 'org_b',
      legalEntityId: 'le_b',
      aggregateType: 'journal_entry',
      aggregateId: 'j1',
      aggregateVersion: 1,
      aggregateDigest: 'd',
      eventType: 'journal.posted',
      actorId: 'spy',
      occurredAt: '2026-08-01T00:00:00.000Z',
      sequence: 1,
      canonicalPayloadVersion: 1,
      hashAlgorithmVersion: 'sha256-v1',
      eventHash: 'h',
    } as any)
    storeRef.current.notifications.set('ntf_b', {
      id: 'ntf_b',
      schemaVersion: 1,
      orgId: 'org_b',
      legalEntityId: 'le_b',
      kind: 'practice.generic',
      status: 'unread',
      title: 'secret',
      body: 'should not leak',
      actorId: 'spy',
      createdAt: '2026-08-01T00:00:00.000Z',
      externalEgressAllowed: false,
    })

    const svc = serviceWith(storeRef)
    const adminA = baseActor()

    await svc.assignRole(adminA, {
      id: 'asg_new',
      orgId: 'org_a',
      userId: 'user_clerk',
      legalEntityId: 'le_a',
      role: 'bookkeeper',
      requestId: 'r1',
      idempotencyKey: 'k1',
    })

    const bundleA = await svc.getBundle(adminA, 'org_a')
    expect(bundleA.assignments.every((a) => a.orgId === 'org_a')).toBe(true)
    expect(bundleA.assignments.some((a) => a.id === 'foreign')).toBe(false)
    expect(bundleA.auditEvents.every((e) => e.orgId === 'org_a')).toBe(true)
    expect(bundleA.auditEvents.some((e) => e.id === 'aud_b')).toBe(false)
    expect(bundleA.notifications.every((n) => n.orgId === 'org_a')).toBe(true)
    expect(bundleA.notifications.some((n) => n.id === 'ntf_b')).toBe(false)
    expect(bundleA.safety.noSarsSubmit).toBe(true)
    expect(bundleA.safety.noExternalPaymentInitiate).toBe(true)

    // Actor for org_b cannot use org_a actor context
    const adminB = baseActor({
      orgId: 'org_b',
      uid: 'user_admin',
      assignments: [{
        id: 'asg_b',
        orgId: 'org_b',
        userId: 'user_admin',
        legalEntityId: 'le_b',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      }],
    })
    await expect(
      svc.assignRole(adminB, {
        id: 'cross',
        orgId: 'org_a',
        userId: 'x',
        legalEntityId: 'le_a',
        role: 'bookkeeper',
        requestId: 'r2',
        idempotencyKey: 'k2',
      }),
    ).rejects.toThrow(/organization does not match/i)

    const filtered = filterAuditEventsForQuery(storeRef.current.auditEvents.values(), { orgId: 'org_a' })
    expect(filtered.every((e) => e.orgId === 'org_a')).toBe(true)
  })

  test('practice multi-client switcher only lists memberships for the actor', () => {
    const clients = buildPracticeClientSummaries({
      actorUid: 'user_admin',
      currentOrgId: 'org_a',
      memberships: [
        {
          orgId: 'org_a',
          orgName: 'Alpha',
          userId: 'user_admin',
          role: 'admin',
          active: true,
          financeModuleEnabled: true,
        },
        {
          orgId: 'org_b',
          orgName: 'Beta',
          userId: 'user_admin',
          role: 'member',
          active: true,
          financeModuleEnabled: true,
        },
        {
          orgId: 'org_c',
          orgName: 'Gamma secret',
          userId: 'other',
          role: 'admin',
          active: true,
          financeModuleEnabled: true,
        },
      ],
      assignments: [
        {
          id: '1',
          orgId: 'org_a',
          userId: 'user_admin',
          legalEntityId: 'le_a',
          scopeMode: 'entity',
          role: 'finance_admin',
          status: 'active',
        },
        {
          id: '2',
          orgId: 'org_b',
          userId: 'user_admin',
          legalEntityId: 'le_b',
          scopeMode: 'entity',
          role: 'accountant',
          status: 'active',
        },
        {
          id: '3',
          orgId: 'org_c',
          userId: 'other',
          legalEntityId: 'le_c',
          scopeMode: 'entity',
          role: 'finance_admin',
          status: 'active',
        },
      ],
    })
    expect(clients.map((c) => c.orgId).sort()).toEqual(['org_a', 'org_b'])
    expect(clients.find((c) => c.orgId === 'org_a')?.isCurrent).toBe(true)
    expect(clients.find((c) => c.orgId === 'org_b')?.roles).toEqual(['accountant'])
  })

  test('notifications emit/mark stay org-scoped and egress-false', async () => {
    const storeRef = { current: createEmptyPracticeStore() }
    const svc = serviceWith(storeRef)
    const admin = baseActor()
    const n = await svc.emitNotification(admin, {
      id: 'ntf1',
      orgId: 'org_a',
      legalEntityId: 'le_a',
      kind: 'payroll.run.submitted',
      title: 'Pay run submitted',
      body: 'Awaiting approval',
      requestId: 'r',
      idempotencyKey: 'nk1',
    })
    expect(n.externalEgressAllowed).toBe(false)
    expect(n.orgId).toBe('org_a')
    const marked = await svc.markNotification(admin, {
      id: 'ntf1',
      orgId: 'org_a',
      status: 'read',
      requestId: 'r2',
      idempotencyKey: 'nk2',
    })
    expect(marked.status).toBe('read')
    await expect(
      svc.markNotification(admin, {
        id: 'ntf1',
        orgId: 'org_b',
        status: 'dismissed',
        requestId: 'r3',
        idempotencyKey: 'nk3',
      }),
    ).rejects.toThrow()
  })
})
