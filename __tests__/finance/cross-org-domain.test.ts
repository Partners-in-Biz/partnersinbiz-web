import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  CrossOrgFinanceService,
  createEmptyCrossOrgStore,
  type CrossOrgFinanceStore,
  type CrossOrgLinkResolver,
} from '@/lib/finance/cross-org/service'

function actor(uid: string, orgId: string, role: FinanceActorContext['membershipRole'] = 'admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [
            {
              id: 'asg1',
              orgId,
              userId: uid,
              legalEntityId: 'le_1',
              scopeMode: 'entity',
              role: 'finance_admin',
              status: 'active',
            },
          ]
        : [],
  }
}

function serviceWith(
  storeRef: { current: CrossOrgFinanceStore },
  resolveLink: CrossOrgLinkResolver,
) {
  return new CrossOrgFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    resolveLink,
    () => '2026-08-02T12:00:00.000Z',
  )
}

describe('cross-org payment notify domain', () => {
  test('source can notify via linkedOrgId; recipient confirms; external payment never initiated', async () => {
    const storeRef = { current: createEmptyCrossOrgStore() }
    const resolveLink: CrossOrgLinkResolver = async ({ sourceCompanyId }) => {
      if (sourceCompanyId === 'co_client') {
        return { recipientOrgId: 'org_client', sourceCompanyId: 'co_client', reason: 'linkedOrgId' }
      }
      return null
    }
    const svc = serviceWith(storeRef, resolveLink)
    const source = actor('user_source', 'org_pib')
    const recipient = actor('user_client', 'org_client')

    const notice = await svc.notifyPayment(source, {
      id: 'xon_1',
      orgId: 'org_pib',
      sourceCompanyId: 'co_client',
      sourcePaymentId: 'pay_1',
      perspective: 'inbound_to_recipient',
      amountMinor: 250_00,
      currency: 'ZAR',
      description: 'Invoice settlement observed',
      observedDate: '2026-08-01',
      method: 'eft',
      requestId: 'r1',
      idempotencyKey: 'k1',
    })
    expect(notice.status).toBe('notified')
    expect(notice.recipientOrgId).toBe('org_client')
    expect(notice.externalPaymentInitiated).toBe(false)

    const inbox = await svc.listForOrg(recipient, 'org_client', 'inbox')
    expect(inbox.notices).toHaveLength(1)
    expect(inbox.externalPaymentInitiated).toBe(false)

    const confirmed = await svc.confirmPayment(recipient, {
      id: 'xon_1',
      orgId: 'org_client',
      recipientPaymentId: 'pay_local_1',
      resolutionNote: 'Banked',
      requestId: 'r2',
      idempotencyKey: 'k2',
    })
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.recipientPaymentId).toBe('pay_local_1')
    expect(confirmed.externalPaymentInitiated).toBe(false)

    await expect(
      svc.confirmPayment(recipient, {
        id: 'xon_1',
        orgId: 'org_client',
        requestId: 'r3',
        idempotencyKey: 'k3',
      }),
    ).rejects.toThrow(/Only notified/)
  })

  test('rejects notify without lawful CRM/relationship link and blocks cross-tenant read', async () => {
    const storeRef = { current: createEmptyCrossOrgStore() }
    const svc = serviceWith(storeRef, async () => null)
    const source = actor('user_source', 'org_pib')
    const stranger = actor('user_x', 'org_other')

    await expect(
      svc.notifyPayment(source, {
        id: 'xon_2',
        orgId: 'org_pib',
        recipientOrgId: 'org_client',
        sourcePaymentId: 'pay_2',
        perspective: 'inbound_to_recipient',
        amountMinor: 100,
        currency: 'ZAR',
        description: 'No link',
        observedDate: '2026-08-01',
        requestId: 'r4',
        idempotencyKey: 'k4',
      }),
    ).rejects.toThrow(/No lawful cross-org link/)

    // Seed a notice manually then ensure stranger org cannot list it as inbox/sent.
    storeRef.current.notices.set('xon_seed', {
      id: 'xon_seed',
      sourceOrgId: 'org_pib',
      recipientOrgId: 'org_client',
      sourcePaymentId: 'pay_seed',
      perspective: 'inbound_to_recipient',
      amountMinor: 50,
      currency: 'ZAR',
      description: 'seed',
      observedDate: '2026-08-01',
      status: 'notified',
      notifiedBy: 'user_source',
      notifiedAt: '2026-08-02T12:00:00.000Z',
      schemaVersion: 1,
      version: 1,
      externalPaymentInitiated: false,
    })

    const other = await svc.listForOrg(stranger, 'org_other', 'all')
    expect(other.notices).toHaveLength(0)

    await expect(svc.listForOrg(actor('member_only', 'org_client', 'member'), 'org_client')).rejects.toBeInstanceOf(
      FinanceAuthorizationError,
    )
  })

  test('duplicate source payment notify to same recipient is rejected', async () => {
    const storeRef = { current: createEmptyCrossOrgStore() }
    const svc = serviceWith(storeRef, async () => ({
      recipientOrgId: 'org_client',
      relationshipId: 'rel_1',
      reason: 'businessRelationship',
    }))
    const source = actor('user_source', 'org_pib')
    await svc.notifyPayment(source, {
      id: 'xon_a',
      orgId: 'org_pib',
      recipientOrgId: 'org_client',
      sourcePaymentId: 'pay_dup',
      perspective: 'outbound_from_recipient',
      amountMinor: 10,
      currency: 'ZAR',
      description: 'first',
      observedDate: '2026-08-01',
      requestId: 'r5',
      idempotencyKey: 'k5',
    })
    await expect(
      svc.notifyPayment(source, {
        id: 'xon_b',
        orgId: 'org_pib',
        recipientOrgId: 'org_client',
        sourcePaymentId: 'pay_dup',
        perspective: 'outbound_from_recipient',
        amountMinor: 10,
        currency: 'ZAR',
        description: 'second',
        observedDate: '2026-08-01',
        requestId: 'r6',
        idempotencyKey: 'k6',
      }),
    ).rejects.toThrow(/already notified/)
  })
})
