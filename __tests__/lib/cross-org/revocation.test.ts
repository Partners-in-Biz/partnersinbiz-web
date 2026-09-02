import {
  actionForModule,
  detectOrphanedModuleRecords,
  hasBilateralAcceptance,
  MODULE_CASCADE_RULES,
  moduleCascadeReplayKey,
  planModuleCascade,
  recordScopeAgreementAcceptance,
  shouldApplyModuleAction,
} from '@/lib/cross-org/lifecycle'
import type {
  ModuleCascadePlan,
  PartnerScopeAgreement,
} from '@/lib/cross-org/types'

const NOW = new Date('2026-08-09T12:00:00Z')
const MEMBER_A = { uid: 'admin-a', displayName: 'Admin A', kind: 'human' as const }
const MEMBER_B = { uid: 'admin-b', displayName: 'Admin B', kind: 'human' as const }

function agreement(overrides: Partial<PartnerScopeAgreement> = {}): PartnerScopeAgreement {
  return {
    id: 'scope-ab',
    partnerLinkId: 'link-1',
    direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
    capabilities: ['documents', 'projects'],
    fieldSharingPolicy: {},
    status: 'proposed',
    version: 1,
    schemaVersion: 1,
    proposedByRef: MEMBER_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('bilateral directional scope acceptance', () => {
  it('does not activate with only the grantor acceptance', () => {
    const { agreement: next, fullyAccepted, canActivate } = recordScopeAgreementAcceptance({
      agreement: agreement(),
      side: 'grantor',
      byRef: MEMBER_A,
      at: NOW,
    })
    expect(fullyAccepted).toBe(false)
    expect(canActivate).toBe(false)
    expect(next.status).toBe('proposed')
    expect(next.acceptance?.grantor?.byRef.uid).toBe('admin-a')
    expect(next.acceptance?.grantee).toBeUndefined()
  })

  it('does not activate with only the grantee acceptance', () => {
    const { agreement: next, fullyAccepted, canActivate } = recordScopeAgreementAcceptance({
      agreement: agreement(),
      side: 'grantee',
      byRef: MEMBER_B,
      at: NOW,
    })
    expect(fullyAccepted).toBe(false)
    expect(canActivate).toBe(false)
    expect(next.status).toBe('proposed')
    // Legacy pointer mirrors the grantee side.
    expect(next.acceptedByRef?.uid).toBe('admin-b')
  })

  it('activates once both sides have accepted', () => {
    const first = recordScopeAgreementAcceptance({
      agreement: agreement(),
      side: 'grantor',
      byRef: MEMBER_A,
      at: NOW,
    })
    const second = recordScopeAgreementAcceptance({
      agreement: first.agreement,
      side: 'grantee',
      byRef: MEMBER_B,
      at: NOW,
    })
    expect(second.fullyAccepted).toBe(true)
    expect(second.canActivate).toBe(true)
    expect(second.agreement.status).toBe('active')
    expect(second.agreement.acceptance?.grantor?.byRef.uid).toBe('admin-a')
    expect(second.agreement.acceptance?.grantee?.byRef.uid).toBe('admin-b')
  })

  it('is idempotent when the same side accepts twice', () => {
    const first = recordScopeAgreementAcceptance({
      agreement: agreement(),
      side: 'grantor',
      byRef: MEMBER_A,
      at: NOW,
    })
    const second = recordScopeAgreementAcceptance({
      agreement: first.agreement,
      side: 'grantor',
      byRef: MEMBER_A,
      at: NOW,
    })
    expect(second.fullyAccepted).toBe(false)
    expect(second.agreement.acceptance?.grantor?.byRef.uid).toBe('admin-a')
  })

  it('acceptance order does not matter', () => {
    const granteeFirst = recordScopeAgreementAcceptance({
      agreement: agreement(),
      side: 'grantee',
      byRef: MEMBER_B,
      at: NOW,
    })
    const result = recordScopeAgreementAcceptance({
      agreement: granteeFirst.agreement,
      side: 'grantor',
      byRef: MEMBER_A,
      at: NOW,
    })
    expect(result.fullyAccepted).toBe(true)
    expect(result.agreement.status).toBe('active')
  })

  it('hasBilateralAcceptance rejects single-side and legacy-only rows', () => {
    expect(hasBilateralAcceptance(agreement())).toBe(false)
    expect(hasBilateralAcceptance(agreement({ acceptedByRef: MEMBER_B }))).toBe(false)
    const both = recordScopeAgreementAcceptance({
      agreement: agreement(),
      side: 'grantor',
      byRef: MEMBER_A,
    })
    const complete = recordScopeAgreementAcceptance({
      agreement: both.agreement,
      side: 'grantee',
      byRef: MEMBER_B,
    })
    expect(hasBilateralAcceptance(complete.agreement)).toBe(true)
  })

  it('does not activate a revoked agreement even if both sides accept', () => {
    const revoked = agreement({ status: 'revoked' })
    const grantor = recordScopeAgreementAcceptance({ agreement: revoked, side: 'grantor', byRef: MEMBER_A })
    const grantee = recordScopeAgreementAcceptance({ agreement: grantor.agreement, side: 'grantee', byRef: MEMBER_B })
    expect(grantee.canActivate).toBe(false)
    expect(grantee.agreement.status).toBe('revoked')
  })
})

describe('per-module cascade rules (capability-reduction state machine)', () => {
  it('covers every module with a rule', () => {
    const modules = new Set(MODULE_CASCADE_RULES.map((r) => r.module))
    expect(modules.size).toBe(9)
    expect(modules).toEqual(
      new Set([
        'shares',
        'project_grants',
        'catalogues',
        'open_orders',
        'settlements',
        'attachments',
        'messages',
        'agent_caches',
        'company_workspace_grants',
      ]),
    )
  })

  it('applies the documented actions per trigger', () => {
    // Unlink: revoke shares/project grants/attachments, freeze the rest, reconcile caches.
    expect(actionForModule({ module: 'shares', trigger: 'link.unlinked' })).toBe('revoke')
    expect(actionForModule({ module: 'project_grants', trigger: 'link.unlinked' })).toBe('revoke')
    expect(actionForModule({ module: 'attachments', trigger: 'link.unlinked' })).toBe('revoke')
    expect(actionForModule({ module: 'catalogues', trigger: 'link.unlinked' })).toBe('freeze')
    expect(actionForModule({ module: 'open_orders', trigger: 'link.unlinked' })).toBe('freeze')
    expect(actionForModule({ module: 'settlements', trigger: 'link.unlinked' })).toBe('freeze')
    expect(actionForModule({ module: 'messages', trigger: 'link.unlinked' })).toBe('freeze')
    expect(actionForModule({ module: 'agent_caches', trigger: 'link.unlinked' })).toBe('reconcile')

    // Capability removed: same shape.
    expect(actionForModule({ module: 'shares', trigger: 'capability.reduced' })).toBe('revoke')
    expect(actionForModule({ module: 'catalogues', trigger: 'capability.reduced' })).toBe('freeze')

    // Field narrowed: attachments revoke URLs, others reconcile.
    expect(actionForModule({ module: 'attachments', trigger: 'field.narrowed' })).toBe('revoke')
    expect(actionForModule({ module: 'messages', trigger: 'field.narrowed' })).toBe('reconcile')

    // Offboarding revokes everything.
    expect(actionForModule({ module: 'agent_caches', trigger: 'membership.offboarded' })).toBe('revoke')
  })

  it('plans a full unlink cascade', () => {
    const plan = planModuleCascade({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      resourcesByModule: {
        shares: ['share-1', 'share-2'],
        project_grants: ['proj-org-1'],
        catalogues: ['catalog-1'],
        open_orders: ['order-1'],
        settlements: ['settle-1'],
        attachments: ['attach-1'],
        messages: ['thread-1'],
        agent_caches: ['cache-key-1'],
      },
    })

    const byModule = Object.fromEntries(plan.targets.map((t) => [t.module, t.action]))
    expect(byModule.shares).toBe('revoke')
    expect(byModule.project_grants).toBe('revoke')
    expect(byModule.attachments).toBe('revoke')
    expect(byModule.catalogues).toBe('freeze')
    expect(byModule.open_orders).toBe('freeze')
    expect(byModule.settlements).toBe('freeze')
    expect(byModule.messages).toBe('freeze')
    expect(byModule.agent_caches).toBe('reconcile')

    const shareTarget = plan.targets.find((t) => t.module === 'shares')
    expect(shareTarget?.resourceIds).toEqual(['share-1', 'share-2'])
    expect(plan.events.some((e) => e.eventType === 'module.revoked' && e.metadata?.module === 'shares')).toBe(true)
    expect(plan.events.some((e) => e.eventType === 'module.frozen' && e.metadata?.module === 'catalogues')).toBe(true)
    expect(plan.events.some((e) => e.eventType === 'module.reconciled' && e.metadata?.module === 'agent_caches')).toBe(true)
  })

  it('scopes a capability-reduced plan to the matching capability modules', () => {
    const plan = planModuleCascade({
      trigger: { type: 'capability.reduced', partnerLinkId: 'link-1', scopeAgreementId: 'scope-ab', capability: 'orders' },
      resourcesByModule: {
        project_grants: ['proj-org-1'],
        catalogues: ['catalog-1'],
        open_orders: ['order-1'],
        agent_caches: ['cache-key-1'],
        shares: ['share-1'],
      },
    })
    const modules = plan.targets.map((t) => t.module)
    // orders capability touches catalogues + open_orders (+ unbound modules whose
    // ids were supplied by the adapter: shares, agent_caches).
    expect(modules).toContain('catalogues')
    expect(modules).toContain('open_orders')
    expect(modules).toContain('agent_caches')
    expect(modules).toContain('shares')
    // projects-bound project_grants must NOT participate even though its id was supplied.
    expect(modules).not.toContain('project_grants')
  })

  it('hard-bound modules never participate for a different capability', () => {
    const plan = planModuleCascade({
      trigger: { type: 'capability.reduced', partnerLinkId: 'link-1', capability: 'documents' },
      resourcesByModule: {
        project_grants: ['proj-org-1'],
        catalogues: ['catalog-1'],
        open_orders: ['order-1'],
        settlements: ['settle-1'],
      },
    })
    // Every one of these is bound to projects/orders/invoices — none may be
    // touched by a documents reduction.
    expect(plan.targets).toEqual([])
  })

  it('keeps an unbound module (agent caches) in capability-reduced plans', () => {
    const plan = planModuleCascade({
      trigger: { type: 'capability.reduced', partnerLinkId: 'link-1', capability: 'documents' },
      resourcesByModule: { agent_caches: ['cache-key-1'] },
    })
    expect(plan.targets.map((t) => t.module)).toEqual(['agent_caches'])
    expect(plan.targets[0]?.action).toBe('reconcile')
  })

  it('does not include capability-bound modules that have no records', () => {
    const plan = planModuleCascade({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      resourcesByModule: { shares: ['share-1'] },
    })
    expect(plan.targets).toHaveLength(1)
    expect(plan.targets[0]?.module).toBe('shares')
  })
})

describe('idempotent replay', () => {
  it('skips records already in the target state', () => {
    const revoked = new Set(['share-1'])
    expect(shouldApplyModuleAction({ action: 'revoke', recordId: 'share-1', alreadyInState: (id) => revoked.has(id) })).toBe(false)
    expect(shouldApplyModuleAction({ action: 'revoke', recordId: 'share-2', alreadyInState: (id) => revoked.has(id) })).toBe(true)
    expect(shouldApplyModuleAction({ action: 'freeze', recordId: 'catalog-1', alreadyInState: (id) => id === 'catalog-1' })).toBe(false)
  })

  it('always replays reconcile evidence runs', () => {
    expect(shouldApplyModuleAction({ action: 'reconcile', recordId: 'cache-key-1', alreadyInState: () => true })).toBe(true)
  })

  it('produces a stable replay key for the same plan', () => {
    const plan = planModuleCascade({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      resourcesByModule: {
        shares: ['share-2', 'share-1'],
        agent_caches: ['cache-key-1'],
      },
    })
    const key1 = moduleCascadeReplayKey(plan)
    const key2 = moduleCascadeReplayKey(plan)
    expect(key1).toBe(key2)
    expect(key1).toContain('link.unlinked')
    expect(key1).toContain('shares:revoke')
    // Ordering of resourceIds inside the target must not change the key.
    const plan2 = planModuleCascade({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      resourcesByModule: {
        shares: ['share-1', 'share-2'],
        agent_caches: ['cache-key-1'],
      },
    })
    expect(moduleCascadeReplayKey(plan2)).toBe(key1)
  })

  it('changes the replay key when the trigger changes', () => {
    const unlink = planModuleCascade({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      resourcesByModule: { shares: ['share-1'] },
    })
    const capability = planModuleCascade({
      trigger: { type: 'capability.reduced', partnerLinkId: 'link-1', capability: 'documents' },
      resourcesByModule: { shares: ['share-1'] },
    })
    expect(moduleCascadeReplayKey(unlink)).not.toBe(moduleCascadeReplayKey(capability))
  })
})

describe('orphan detection', () => {
  it('reports every record still referencing a dead trigger', () => {
    const orphans = detectOrphanedModuleRecords({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      records: {
        shares: ['share-1'],
        project_grants: ['proj-org-1'],
        catalogues: ['catalog-1'],
      },
    })
    expect(orphans).toHaveLength(3)
    expect(orphans.map((o) => o.module)).toEqual(['shares', 'project_grants', 'catalogues'])
    expect(orphans[0]?.reason).toBe('link.unlinked.orphan')
    expect(orphans[0]?.resourceId).toBe('share-1')
  })

  it('returns no orphans when every module is clean', () => {
    const orphans = detectOrphanedModuleRecords({
      trigger: { type: 'link.unlinked', partnerLinkId: 'link-1' },
      records: {},
    })
    expect(orphans).toEqual([])
  })

  it('reports capability-reduction orphans with capability detail', () => {
    const orphans = detectOrphanedModuleRecords({
      trigger: { type: 'capability.reduced', partnerLinkId: 'link-1', capability: 'documents' },
      records: { attachments: ['attach-1'] },
    })
    expect(orphans).toHaveLength(1)
    expect(orphans[0]?.module).toBe('attachments')
    expect(orphans[0]?.reason).toBe('capability.reduced.orphan')
  })
})

describe('plan type shape', () => {
  it('builds a valid ModuleCascadePlan', () => {
    const plan = planModuleCascade({
      trigger: { type: 'field.narrowed', partnerLinkId: 'link-1', field: 'attachmentUrl' },
      resourcesByModule: { attachments: ['attach-1'] },
    })
    const p: ModuleCascadePlan = plan
    expect(p.trigger.type).toBe('field.narrowed')
    expect(p.trigger.field).toBe('attachmentUrl')
    expect(p.targets[0]?.action).toBe('revoke')
  })
})
