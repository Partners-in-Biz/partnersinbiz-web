import {
  assertBookkeeperCannotApprovePayRun,
  buildGuidedWorkflowView,
  buildRoleHubModules,
  exportAuditEventsCsv,
  filterNotificationsForCentre,
  FINANCE_GUIDED_WORKFLOWS,
  FINANCE_ROLE_HUB_MODULES,
  resolveFinancePersona,
  uniqueAuditActors,
  uniqueAuditEventTypes,
} from '@/lib/finance/role-ux/catalog'
import type { FinanceRoleUxContext } from '@/lib/finance/role-ux/types'
import type { PracticeAuditEventView } from '@/lib/finance/practice/types'
import { authorizeFinanceAction, FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext, FinanceRole, FinanceRoleAssignment } from '@/lib/finance/types'

function ctx(partial: Partial<FinanceRoleUxContext> & { roles: readonly FinanceRole[] }): FinanceRoleUxContext {
  return {
    membershipRole: partial.membershipRole ?? 'member',
    roles: partial.roles,
    practiceClientCount: partial.practiceClientCount ?? 1,
  }
}

function policyActor(role: FinanceRole, uid = 'u1'): FinanceActorContext {
  const assignment: FinanceRoleAssignment = {
    id: 'asg1',
    orgId: 'org_a',
    userId: uid,
    legalEntityId: 'le_a',
    scopeMode: 'entity',
    role,
    status: 'active',
  }
  return {
    uid,
    orgId: 'org_a',
    membershipRole: 'member',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [assignment],
  }
}

describe('finance role-ux domain', () => {
  test('resolves owner / bookkeeper / accountant / practice personas', () => {
    expect(resolveFinancePersona(ctx({ roles: ['finance_admin'], membershipRole: 'admin' }))).toBe('owner')
    expect(resolveFinancePersona(ctx({ roles: ['bookkeeper'] }))).toBe('bookkeeper')
    expect(resolveFinancePersona(ctx({ roles: ['accountant'] }))).toBe('accountant')
    expect(
      resolveFinancePersona(
        ctx({ roles: ['accountant'], membershipRole: 'admin', practiceClientCount: 3 }),
      ),
    ).toBe('practice')
  })

  test('role hub modules are persona-scoped and role-gated', () => {
    const ownerModules = buildRoleHubModules(ctx({ roles: ['finance_admin'], membershipRole: 'owner' }), {
      persona: 'owner',
    })
    expect(ownerModules.map((m) => m.id)).toEqual(
      expect.arrayContaining(['owner.cash', 'owner.runway', 'owner.approvals']),
    )
    expect(ownerModules.every((m) => m.persona === 'owner')).toBe(true)

    const bookkeeperModules = buildRoleHubModules(ctx({ roles: ['bookkeeper'] }), { persona: 'bookkeeper' })
    expect(bookkeeperModules.map((m) => m.id)).toEqual(
      expect.arrayContaining(['bookkeeper.daily_capture', 'bookkeeper.recon_queue', 'bookkeeper.bank_import']),
    )
    expect(bookkeeperModules.some((m) => m.id === 'owner.approvals')).toBe(false)
    expect(bookkeeperModules.some((m) => m.id === 'accountant.period_close')).toBe(false)

    const viewerOnly = buildRoleHubModules(ctx({ roles: ['finance_viewer'] }), { persona: 'bookkeeper' })
    expect(viewerOnly.some((m) => m.id === 'bookkeeper.daily_capture')).toBe(false)
    expect(viewerOnly.length).toBe(0)

    const accountant = buildRoleHubModules(ctx({ roles: ['accountant'] }), { persona: 'accountant' })
    expect(accountant.map((m) => m.id)).toEqual(
      expect.arrayContaining(['accountant.period_close', 'accountant.reports', 'accountant.packs']),
    )

    const practice = buildRoleHubModules(
      ctx({ roles: ['finance_admin'], membershipRole: 'admin', practiceClientCount: 4 }),
      { persona: 'practice' },
    )
    expect(practice.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        'practice.multi_client',
        'practice.notification_centre',
        'practice.audit_explorer',
      ]),
    )

    expect(FINANCE_ROLE_HUB_MODULES.length).toBeGreaterThanOrEqual(12)
  })

  test('bookkeeper cannot complete pay-run approve step; payroll_approver can', () => {
    const bk = ctx({ roles: ['bookkeeper'] })
    expect(assertBookkeeperCannotApprovePayRun(bk)).toBe(true)
    const bkView = buildGuidedWorkflowView('first_pay_run', bk)
    const approve = bkView.steps.find((s) => s.id === 'pay.approve')
    expect(approve?.canComplete).toBe(false)
    expect(approve?.status).toBe('blocked_role')

    const appr = ctx({ roles: ['payroll_approver'] })
    const apprView = buildGuidedWorkflowView('first_pay_run', appr)
    expect(apprView.steps.find((s) => s.id === 'pay.approve')?.canComplete).toBe(true)

    expect(() =>
      authorizeFinanceAction(policyActor('bookkeeper'), { orgId: 'org_a', legalEntityId: 'le_a' }, 'payroll.run.approve'),
    ).toThrow(FinanceAuthorizationError)
    expect(() =>
      authorizeFinanceAction(
        policyActor('payroll_approver'),
        { orgId: 'org_a', legalEntityId: 'le_a' },
        'payroll.run.approve',
      ),
    ).not.toThrow()
  })

  test('guided workflows cover first month close, pay run, and bank recon', () => {
    expect(FINANCE_GUIDED_WORKFLOWS.map((w) => w.id).sort()).toEqual([
      'first_bank_recon',
      'first_month_close',
      'first_pay_run',
    ])

    const close = buildGuidedWorkflowView(
      'first_month_close',
      ctx({ roles: ['bookkeeper'] }),
    )
    expect(close.steps.find((s) => s.id === 'close.capture')?.canComplete).toBe(true)
    expect(close.steps.find((s) => s.id === 'close.period')?.canComplete).toBe(false)

    const recon = buildGuidedWorkflowView(
      'first_bank_recon',
      ctx({ roles: ['bookkeeper'] }),
    )
    expect(recon.steps.find((s) => s.id === 'recon.import')?.canComplete).toBe(true)
    expect(recon.steps.find((s) => s.id === 'recon.approve')?.canComplete).toBe(false)
    expect(recon.steps.find((s) => s.id === 'recon.approve')?.approvalGated).toBe(true)

    const ownerRecon = buildGuidedWorkflowView(
      'first_bank_recon',
      ctx({ roles: ['finance_approver'] }),
    )
    expect(ownerRecon.steps.find((s) => s.id === 'recon.approve')?.canComplete).toBe(true)
  })

  test('notification centre filters by status, kind, and query', () => {
    const rows = [
      {
        kind: 'payroll.run.submitted' as const,
        status: 'unread' as const,
        title: 'Pay run submitted',
        body: 'Awaiting approval',
      },
      {
        kind: 'cutover.ready' as const,
        status: 'read' as const,
        title: 'Cutover ready',
        body: 'Package validated',
      },
      {
        kind: 'reconciliation.awaiting_approval' as const,
        status: 'unread' as const,
        title: 'Recon waiting',
        body: 'Difference zero',
      },
    ]
    expect(filterNotificationsForCentre(rows, { status: 'unread' })).toHaveLength(2)
    expect(filterNotificationsForCentre(rows, { kind: 'cutover.ready' })).toHaveLength(1)
    expect(filterNotificationsForCentre(rows, { query: 'difference' })[0]?.title).toBe('Recon waiting')
    expect(filterNotificationsForCentre(rows, { status: 'unread', kind: 'payroll.run.submitted' })).toHaveLength(1)
  })

  test('audit CSV export includes header and filtered org rows only', () => {
    const events: PracticeAuditEventView[] = [
      {
        id: 'a1',
        orgId: 'org_a',
        legalEntityId: 'le_a',
        bookId: 'book_1',
        eventType: 'role.assigned',
        actorId: 'admin',
        aggregateType: 'finance_role_assignment',
        aggregateId: 'asg1',
        occurredAt: '2026-08-03T10:00:00.000Z',
        sequence: 1,
        eventHash: 'h1',
        externalEgressAllowed: false,
      },
      {
        id: 'a2',
        orgId: 'org_a',
        legalEntityId: 'le_b',
        eventType: 'journal.posted',
        actorId: 'bk',
        aggregateType: 'journal_entry',
        aggregateId: 'j1',
        occurredAt: '2026-08-03T11:00:00.000Z',
        sequence: 2,
        eventHash: 'h2',
        externalEgressAllowed: false,
      },
    ]
    const csv = exportAuditEventsCsv(events)
    expect(csv.startsWith('occurredAt,eventType,actorId,legalEntityId')).toBe(true)
    expect(csv).toContain('role.assigned')
    expect(csv).toContain('journal.posted')
    expect(csv).toContain('org_a')
    expect(csv.split('\n').filter(Boolean).length).toBe(3) // header + 2
    expect(uniqueAuditActors(events)).toEqual(['admin', 'bk'])
    expect(uniqueAuditEventTypes(events)).toEqual(['journal.posted', 'role.assigned'])

    const empty = exportAuditEventsCsv([])
    expect(empty).toContain('eventType')
    expect(empty.trim().split('\n')).toHaveLength(1)
  })

  test('hard-gate notes stay on packaging / approve steps', () => {
    const pay = buildGuidedWorkflowView('first_pay_run', ctx({ roles: ['payroll_approver'] }))
    expect(pay.steps.find((s) => s.id === 'pay.approve')?.hardGateNote).toMatch(/externalPaymentInitiated=false/)
    expect(pay.steps.find((s) => s.id === 'pay.pack')?.hardGateNote).toMatch(/massEmailAllowed=false/)
    const close = buildGuidedWorkflowView('first_month_close', ctx({ roles: ['accountant'] }))
    expect(close.steps.find((s) => s.id === 'close.pack')?.hardGateNote).toMatch(/sarsSubmissionInitiated=false/)
  })
})
