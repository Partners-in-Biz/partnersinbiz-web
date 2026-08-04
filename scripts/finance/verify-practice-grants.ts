/**
 * Development verification for firm→client practice grants.
 * No SARS submit, no payment initiate, no client-visible messages, no packaging egress open.
 */
import assert from 'assert'
import {
  PracticeFinanceService,
  createEmptyPracticeStore,
  type PracticeFinanceStore,
} from '../../lib/finance/practice/service'
import type { FinanceActorContext } from '../../lib/finance/types'

function admin(): FinanceActorContext {
  return {
    uid: 'verify_admin',
    orgId: 'firm_verify',
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg',
        orgId: 'firm_verify',
        userId: 'verify_admin',
        legalEntityId: 'le_v',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

function prep(): FinanceActorContext {
  return {
    uid: 'verify_prep',
    orgId: 'firm_verify',
    membershipRole: 'member',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg_p',
        orgId: 'firm_verify',
        userId: 'verify_prep',
        legalEntityId: 'le_v',
        scopeMode: 'entity',
        role: 'bookkeeper',
        status: 'active',
      },
    ],
  }
}

async function main() {
  const storeRef: { current: PracticeFinanceStore } = { current: createEmptyPracticeStore() }
  const svc = new PracticeFinanceService(
    async () => storeRef.current,
    async (_b, a) => {
      storeRef.current = a
    },
    () => '2026-08-03T16:00:00.000Z',
  )
  const a = admin()
  const p = prep()

  await svc.upsertClientLink(a, {
    id: 'link_v',
    firmOrgId: 'firm_verify',
    clientOrgId: 'client_verify',
    clientName: 'Verify Client',
    closeBlockerCount: 1,
    openPeriodCount: 2,
    requestId: '1',
    idempotencyKey: 'link',
  })

  const grant = await svc.createGrant(a, {
    id: 'g_v',
    firmOrgId: 'firm_verify',
    clientOrgId: 'client_verify',
    granteeUserId: 'verify_prep',
    role: 'prepare',
    requestId: '2',
    idempotencyKey: 'g',
  })
  assert.strictEqual(grant.role, 'prepare')
  assert.strictEqual(grant.externalEgressAllowed, false)
  assert.strictEqual(grant.clientVisibleMessagesAllowed, false)
  assert.strictEqual(grant.externalPaymentInitiated, false)
  assert.strictEqual(grant.sarsSubmissionInitiated, false)

  const ok = await svc.authorizeGrantAccess(p, {
    firmOrgId: 'firm_verify',
    clientOrgId: 'client_verify',
    action: 'invoice.create',
    requestId: '3',
    idempotencyKey: 'auth-ok',
  })
  assert.strictEqual(ok.allowed, true)

  let denied = false
  try {
    await svc.authorizeGrantAccess(p, {
      firmOrgId: 'firm_verify',
      clientOrgId: 'client_verify',
      action: 'payroll.run.approve',
      requestId: '4',
      idempotencyKey: 'auth-deny',
    })
  } catch {
    denied = true
  }
  assert.strictEqual(denied, true)

  await svc.revokeGrant(a, {
    id: 'g_v',
    firmOrgId: 'firm_verify',
    reason: 'verify revoke',
    requestId: '5',
    idempotencyKey: 'rev',
  })

  let afterRevokeDenied = false
  try {
    await svc.authorizeGrantAccess(p, {
      firmOrgId: 'firm_verify',
      clientOrgId: 'client_verify',
      action: 'invoice.create',
      requestId: '6',
      idempotencyKey: 'auth-post-rev',
    })
  } catch {
    afterRevokeDenied = true
  }
  assert.strictEqual(afterRevokeDenied, true)

  const bundle = await svc.getBundle(a, 'firm_verify')
  assert.strictEqual(bundle.safety.noSarsSubmit, true)
  assert.strictEqual(bundle.safety.noExternalPaymentInitiate, true)
  assert.strictEqual(bundle.safety.externalEgressAllowed, false)
  assert.strictEqual(bundle.safety.clientVisibleMessagesAllowed, false)
  assert.strictEqual(bundle.safety.practiceGrantsEnabled, true)
  assert.ok(bundle.practiceQueue.some((q) => q.attention === 'close_blocker'))
  assert.ok(bundle.grantAccessEvents.some((e) => e.action === 'grant.create'))
  assert.ok(bundle.grantAccessEvents.some((e) => e.action === 'grant.revoke'))
  assert.ok(bundle.grantAccessEvents.every((e) => e.externalEgressAllowed === false))
  assert.ok(bundle.grantAccessEvents.every((e) => e.clientVisibleMessagesAllowed === false))

  console.log(
    JSON.stringify({
      ok: true,
      grantRoles: ['prepare', 'review', 'file-export'],
      safety: bundle.safety,
      queueAttention: bundle.practiceQueue.map((q) => q.attention),
      accessEvents: bundle.grantAccessEvents.map((e) => e.action),
      noEgress: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      clientVisibleMessagesAllowed: false,
    }),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
