/**
 * POST /api/v1/admin/billing/dunning/run — the EFT dunning escalation engine.
 *
 * Manual "Run now" trigger (also cron-safe). For every overdue invoice:
 *   1. Ensure a `dunning_sequences` doc exists.
 *   2. Compute which stage is now due from daysAfterDue vs (now - dueDate).
 *   3. If a new stage is due, render the template, attempt a real email send,
 *      otherwise queue a `dunning_emails` doc; record it in the sequence
 *      history and advance currentStage.
 *   4. If that stage has suspend:true → set the org's subscription status to
 *      'suspended' and the sequence status to 'suspended'.
 * If an invoice is no longer overdue (paid / not in the overdue set) its
 * sequence is marked 'resolved'.
 *
 * NO card retries — this is EFT reminders only. Returns a summary of actions.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { sendEmail } from '@/lib/email/send'
import type { DunningConfig, DunningSequence } from '@/lib/billing/types'
import {
  DUNNING_CONFIG_COLLECTION,
  DUNNING_CONFIG_DOC,
  DUNNING_SEQUENCES_COLLECTION,
  DUNNING_EMAILS_COLLECTION,
  defaultDunningConfig,
  loadOverdueInvoices,
  renderTemplate,
} from '../shared'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000

function formatAmount(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency || 'ZAR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(total) ? total : 0)
  } catch {
    return `${currency || 'ZAR'} ${(Number.isFinite(total) ? total : 0).toFixed(2)}`
  }
}

/** Suspend every subscription belonging to an org. */
async function suspendOrgSubscriptions(orgId: string): Promise<number> {
  const subs = await adminDb.collection('subscriptions').where('orgId', '==', orgId).get()
  let count = 0
  for (const doc of subs.docs) {
    const status = (doc.data() as { status?: string }).status
    if (status === 'suspended') continue
    await doc.ref.update({ status: 'suspended', updatedAt: FieldValue.serverTimestamp() })
    count += 1
  }
  return count
}

export const POST = withAuth('admin', async (_req, user) => {
  const [configSnap, orgsSnap, overdueInvoices, seqSnap] = await Promise.all([
    adminDb.collection(DUNNING_CONFIG_COLLECTION).doc(DUNNING_CONFIG_DOC).get(),
    adminDb.collection('organizations').get(),
    loadOverdueInvoices(),
    adminDb.collection(DUNNING_SEQUENCES_COLLECTION).get(),
  ])

  const config: DunningConfig = configSnap.exists
    ? { id: configSnap.id, ...(configSnap.data() as DunningConfig) }
    : defaultDunningConfig()

  const orgName = new Map<string, string>()
  for (const doc of orgsSnap.docs) {
    const o = doc.data() as { name?: string }
    orgName.set(doc.id, o.name ?? doc.id)
  }

  // Index existing sequences by invoiceId.
  const seqByInvoice = new Map<string, { id: string; data: DunningSequence }>()
  for (const doc of seqSnap.docs) {
    const data = doc.data() as DunningSequence
    if (data.invoiceId) seqByInvoice.set(data.invoiceId, { id: doc.id, data })
  }
  const overdueIds = new Set(overdueInvoices.map((i) => i.id))

  const now = Date.now()
  const summary = {
    active: config.active,
    overdueInvoices: overdueInvoices.length,
    sequencesCreated: 0,
    remindersSent: 0,
    remindersQueued: 0,
    suspensions: 0,
    resolved: 0,
    skipped: 0,
    actions: [] as Array<Record<string, unknown>>,
  }

  if (!config.active) {
    summary.actions.push({ note: 'Dunning is inactive — no reminders processed. Resolving paid sequences only.' })
  }

  const stages = [...(config.stages ?? [])].sort((a, b) => a.daysAfterDue - b.daysAfterDue)

  // 1. Resolve sequences whose invoice is no longer overdue.
  for (const [invoiceId, entry] of seqByInvoice) {
    if (overdueIds.has(invoiceId)) continue
    if (entry.data.status === 'resolved') continue
    await adminDb.collection(DUNNING_SEQUENCES_COLLECTION).doc(entry.id).update({
      status: 'resolved',
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    summary.resolved += 1
    summary.actions.push({ type: 'resolved', invoiceNumber: entry.data.invoiceNumber, orgId: entry.data.orgId })
  }

  // 2. Process overdue invoices (only when active).
  if (config.active && stages.length > 0) {
    for (const inv of overdueInvoices) {
      const daysOverdue = Math.floor((now - (inv.dueDateMs ?? now)) / DAY_MS)
      let existing = seqByInvoice.get(inv.id)
      let seqId = existing?.id
      let currentStage = existing?.data.currentStage ?? 0
      let history = Array.isArray(existing?.data.history) ? [...existing!.data.history] : []
      let status: DunningSequence['status'] = existing?.data.status ?? 'active'

      // Create sequence if missing.
      if (!existing) {
        const newSeq: DunningSequence = {
          orgId: inv.orgId,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          currentStage: 0,
          history: [],
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }
        const ref = await adminDb.collection(DUNNING_SEQUENCES_COLLECTION).add(newSeq)
        seqId = ref.id
        existing = { id: ref.id, data: newSeq }
        currentStage = 0
        history = []
        status = 'active'
        summary.sequencesCreated += 1
        summary.actions.push({ type: 'sequence_created', invoiceNumber: inv.invoiceNumber, orgId: inv.orgId })
      }

      if (status === 'suspended') {
        summary.skipped += 1
        continue
      }

      // Determine how many stages are now due, advancing one stage per run for
      // any stage threshold already crossed but not yet sent.
      // Find the next unsent stage that is due.
      if (currentStage >= stages.length) {
        summary.skipped += 1
        continue
      }
      const stage = stages[currentStage]
      if (daysOverdue < stage.daysAfterDue) {
        summary.skipped += 1
        continue
      }

      // Stage is due — render + send/queue.
      const vars = {
        invoiceNumber: inv.invoiceNumber,
        amount: formatAmount(inv.total, inv.currency),
        orgName: orgName.get(inv.orgId) ?? inv.orgId,
      }
      const subject = renderTemplate(stage.subject, vars)
      const body = renderTemplate(stage.body, vars)
      const html = `<div style="font-family:sans-serif;white-space:pre-wrap">${body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`

      let emailStatus: 'sent' | 'queued' | 'failed' = 'queued'
      let emailError: string | null = null
      if (inv.recipientEmail) {
        const result = await sendEmail({ to: inv.recipientEmail, subject, html }).catch((e) => ({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        }))
        emailStatus = result.success ? 'sent' : 'failed'
        if (!result.success) emailError = result.error ?? 'send failed'
      }

      // Always record a queue/audit doc so we have a trail even when sent.
      await adminDb.collection(DUNNING_EMAILS_COLLECTION).add({
        orgId: inv.orgId,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        stage: currentStage,
        to: inv.recipientEmail ?? null,
        subject,
        body,
        status: emailStatus,
        error: emailError,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: user.uid,
      })

      if (emailStatus === 'sent') summary.remindersSent += 1
      else summary.remindersQueued += 1

      history.push({ stage: currentStage, sentAt: Timestamp.now() })
      const nextStage = currentStage + 1

      const update: Record<string, unknown> = {
        currentStage: nextStage,
        history,
        updatedAt: FieldValue.serverTimestamp(),
      }

      // Suspend on final-stage suspend flag.
      if (stage.suspend) {
        const suspended = await suspendOrgSubscriptions(inv.orgId)
        summary.suspensions += suspended
        update.status = 'suspended'
        status = 'suspended'
        summary.actions.push({
          type: 'suspended',
          invoiceNumber: inv.invoiceNumber,
          orgId: inv.orgId,
          subscriptionsSuspended: suspended,
        })
      }

      await adminDb.collection(DUNNING_SEQUENCES_COLLECTION).doc(seqId!).update(update)

      summary.actions.push({
        type: 'reminder',
        stage: currentStage,
        emailStatus,
        invoiceNumber: inv.invoiceNumber,
        orgId: inv.orgId,
        to: inv.recipientEmail ?? null,
      })
    }
  }

  return apiSuccess(summary)
})
