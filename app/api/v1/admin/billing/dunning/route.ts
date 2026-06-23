/**
 * GET  /api/v1/admin/billing/dunning — return the dunning config, active
 *      sequences (joined with org name), and overdue invoices not yet in a
 *      sequence.
 * PUT  /api/v1/admin/billing/dunning — upsert the dunning config.
 *
 * IMPORTANT: This is EFT-first dunning. There are NO card retries (no Stripe).
 * "Dunning" here means a sequence of EFT payment-reminder emails. The final
 * stage can suspend the org's subscription. Config is a singleton doc stored
 * at `billing_config/dunning`. Per-org sequences live in `dunning_sequences`.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { DunningConfig, DunningStage, DunningSequence } from '@/lib/billing/types'
import {
  DUNNING_CONFIG_COLLECTION,
  DUNNING_CONFIG_DOC,
  DUNNING_SEQUENCES_COLLECTION,
  defaultDunningConfig,
  loadOverdueInvoices,
  toMillis,
} from './shared'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const [configSnap, seqSnap, orgsSnap, overdueInvoices] = await Promise.all([
    adminDb.collection(DUNNING_CONFIG_COLLECTION).doc(DUNNING_CONFIG_DOC).get(),
    adminDb.collection(DUNNING_SEQUENCES_COLLECTION).get(),
    adminDb.collection('organizations').get(),
    loadOverdueInvoices(),
  ])

  const config: DunningConfig = configSnap.exists
    ? { id: configSnap.id, ...(configSnap.data() as DunningConfig) }
    : defaultDunningConfig()

  const orgName = new Map<string, string>()
  for (const doc of orgsSnap.docs) {
    const o = doc.data() as { name?: string }
    orgName.set(doc.id, o.name ?? doc.id)
  }

  const sequences = seqSnap.docs
    .map((doc) => {
      const seq = { id: doc.id, ...(doc.data() as DunningSequence) }
      const lastHistory = Array.isArray(seq.history) && seq.history.length > 0
        ? seq.history[seq.history.length - 1]
        : null
      return {
        ...seq,
        orgName: seq.orgId ? orgName.get(seq.orgId) ?? seq.orgId : seq.orgId,
        lastSentAt: lastHistory ? toMillis(lastHistory.sentAt) : null,
        createdAtMs: toMillis(seq.createdAt),
      }
    })
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'active') return -1
        if (b.status === 'active') return 1
      }
      return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)
    })

  const sequencedInvoiceIds = new Set(seqSnap.docs.map((d) => (d.data() as DunningSequence).invoiceId))
  const overdue = overdueInvoices
    .filter((inv) => !sequencedInvoiceIds.has(inv.id))
    .map((inv) => ({
      ...inv,
      orgName: inv.orgId ? orgName.get(inv.orgId) ?? inv.orgId : inv.orgId,
    }))

  return apiSuccess({ config, sequences, overdueInvoices: overdue })
})

function validateStages(input: unknown): DunningStage[] | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'At least one stage is required' }
  }
  const stages: DunningStage[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { error: 'Invalid stage' }
    const s = raw as Record<string, unknown>
    const daysAfterDue = Number(s.daysAfterDue)
    if (!Number.isFinite(daysAfterDue) || daysAfterDue < 0) {
      return { error: 'Each stage needs a non-negative daysAfterDue number' }
    }
    const subject = typeof s.subject === 'string' ? s.subject.trim() : ''
    const body = typeof s.body === 'string' ? s.body.trim() : ''
    if (!subject) return { error: 'Each stage needs a subject' }
    if (!body) return { error: 'Each stage needs a body' }
    stages.push({
      daysAfterDue: Math.round(daysAfterDue),
      subject,
      body,
      suspend: Boolean(s.suspend),
    })
  }
  stages.sort((a, b) => a.daysAfterDue - b.daysAfterDue)
  return stages
}

export const PUT = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const stages = validateStages(body.stages)
  if ('error' in stages) return apiError(stages.error, 400)

  const config = {
    active: Boolean(body.active),
    stages,
    ...lastActorFrom(user),
  }

  await adminDb
    .collection(DUNNING_CONFIG_COLLECTION)
    .doc(DUNNING_CONFIG_DOC)
    .set(config, { merge: true })

  const saved = await adminDb.collection(DUNNING_CONFIG_COLLECTION).doc(DUNNING_CONFIG_DOC).get()
  return apiSuccess({ config: { id: saved.id, ...(saved.data() as DunningConfig) } })
})
