import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  CrossOrgFinanceService,
  cloneCrossOrgStore,
  createEmptyCrossOrgStore,
  type CrossOrgFinanceStore,
  type CrossOrgLinkResolver,
  type NotifyCrossOrgPaymentCommand,
  type ResolveCrossOrgPaymentCommand,
} from './service'
import type { CrossOrgLinkEvidence, CrossOrgPaymentNotice } from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(): Promise<CrossOrgFinanceStore> {
  const db = adminDb
  const [notices, claims] = await Promise.all([
    db.collection('finance_cross_org_payment_notices').limit(2000).get(),
    db.collection('finance_cross_org_claims').limit(5000).get(),
  ])
  const store = createEmptyCrossOrgStore()
  store.notices = asMap<CrossOrgPaymentNotice>(notices)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(before: CrossOrgFinanceStore, after: CrossOrgFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  for (const [id, value] of after.notices) {
    const prior = before.notices.get(id)
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
    batch.set(db.collection('finance_cross_org_payment_notices').doc(id), value, { merge: true })
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_cross_org_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  await batch.commit()
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Resolve lawful CRM/relationship link without leaking unrelated org data. */
export const defaultCrossOrgLinkResolver: CrossOrgLinkResolver = async (input) => {
  const sourceOrgId = clean(input.sourceOrgId)
  if (!sourceOrgId) return null

  const explicitRecipient = clean(input.recipientOrgId)
  const sourceCompanyId = clean(input.sourceCompanyId)
  const relationshipId = clean(input.relationshipId)

  if (sourceCompanyId) {
    const snap = await adminDb.collection('companies').doc(sourceCompanyId).get()
    if (!snap.exists) return null
    const data = snap.data() as { orgId?: string; linkedOrgId?: string; deleted?: boolean }
    if (data.deleted === true) return null
    if (clean(data.orgId) !== sourceOrgId) return null
    const linked = clean(data.linkedOrgId)
    if (!linked) return null
    if (explicitRecipient && explicitRecipient !== linked) return null
    return {
      recipientOrgId: linked,
      sourceCompanyId,
      reason: 'linkedOrgId',
    } satisfies CrossOrgLinkEvidence
  }

  if (relationshipId) {
    const snap = await adminDb.collection('businessRelationships').doc(relationshipId).get()
    if (!snap.exists) return null
    const data = snap.data() as {
      sourceOrgId?: string
      targetOrgId?: string
      status?: string
      deleted?: boolean
      sharedCapabilities?: string[]
    }
    if (data.deleted === true) return null
    if (clean(data.sourceOrgId) !== sourceOrgId) return null
    if (clean(data.status) && clean(data.status) !== 'active') return null
    const target = clean(data.targetOrgId)
    if (!target) return null
    if (explicitRecipient && explicitRecipient !== target) return null
    return {
      recipientOrgId: target,
      relationshipId,
      reason: 'businessRelationship',
    } satisfies CrossOrgLinkEvidence
  }

  if (explicitRecipient) {
    // Prefer active business relationship source→target.
    const relSnap = await adminDb
      .collection('businessRelationships')
      .where('sourceOrgId', '==', sourceOrgId)
      .where('targetOrgId', '==', explicitRecipient)
      .limit(20)
      .get()
    for (const doc of relSnap.docs) {
      const data = doc.data() as { status?: string; deleted?: boolean }
      if (data.deleted === true) continue
      if (clean(data.status) && clean(data.status) !== 'active') continue
      return {
        recipientOrgId: explicitRecipient,
        relationshipId: doc.id,
        reason: 'businessRelationship',
      } satisfies CrossOrgLinkEvidence
    }

    // Fall back to CRM company owned by source with linkedOrgId=recipient.
    const companySnap = await adminDb
      .collection('companies')
      .where('orgId', '==', sourceOrgId)
      .where('linkedOrgId', '==', explicitRecipient)
      .limit(5)
      .get()
    for (const doc of companySnap.docs) {
      const data = doc.data() as { deleted?: boolean }
      if (data.deleted === true) continue
      return {
        recipientOrgId: explicitRecipient,
        sourceCompanyId: doc.id,
        reason: 'linkedOrgId',
      } satisfies CrossOrgLinkEvidence
    }
  }

  return null
}

export class FirestoreCrossOrgFinanceGateway {
  constructor(private readonly resolveLink: CrossOrgLinkResolver = defaultCrossOrgLinkResolver) {}

  private service() {
    return new CrossOrgFinanceService(
      () => loadStore(),
      (before, after) => saveStore(before, after),
      this.resolveLink,
    )
  }

  notifyPayment(actor: FinanceActorContext, command: NotifyCrossOrgPaymentCommand) {
    return this.service().notifyPayment(actor, command)
  }

  confirmPayment(actor: FinanceActorContext, command: ResolveCrossOrgPaymentCommand) {
    return this.service().confirmPayment(actor, command)
  }

  disputePayment(actor: FinanceActorContext, command: ResolveCrossOrgPaymentCommand) {
    return this.service().disputePayment(actor, command)
  }

  dismissPayment(actor: FinanceActorContext, command: ResolveCrossOrgPaymentCommand) {
    return this.service().dismissPayment(actor, command)
  }

  listForOrg(actor: FinanceActorContext, orgId: string, view: 'inbox' | 'sent' | 'all' = 'all') {
    return this.service().listForOrg(actor, orgId, view)
  }
}

export type {
  NotifyCrossOrgPaymentCommand,
  ResolveCrossOrgPaymentCommand,
  CrossOrgFinanceStore,
  CrossOrgLinkResolver,
}

export { CrossOrgFinanceService, cloneCrossOrgStore, createEmptyCrossOrgStore }
