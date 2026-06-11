// app/api/cron/invoices/route.ts
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import { generateInvoicePdfShareToken } from '@/lib/invoices/share-token'
import { calculateNextDueAt, RecurrenceInterval } from '@/lib/invoices/recurring'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return apiError('Unauthorized', 401)

  const now = Timestamp.now()

  const snap = await (adminDb.collection('recurring_schedules') as any)
    .where('status', '==', 'active')
    .where('nextDueAt', '<=', now)
    .get()

  let created = 0
  let markedOverdue = 0
  const errors: string[] = []

  for (const scheduleDoc of snap.docs) {
    try {
      const schedule = scheduleDoc.data()

      // Fetch template invoice
      const templateDoc = await adminDb.collection('invoices').doc(schedule.invoiceId).get()
      if (!templateDoc.exists) continue
      const template = templateDoc.data()!

      // Generate a fresh invoice number
      const invoiceNumber = await generateInvoiceNumber(
        template.orgId,
        template.clientDetails?.name ?? template.orgId,
      )

      // Compute relative dueDate if template had one
      let dueDate: any = null
      if (template.dueDate && template.issueDate) {
        const templateIssueSec = template.issueDate._seconds ?? (template.issueDate.toDate ? template.issueDate.toDate().getTime() / 1000 : null)
        const templateDueSec = template.dueDate._seconds ?? (template.dueDate.toDate ? template.dueDate.toDate().getTime() / 1000 : null)
        if (templateIssueSec && templateDueSec) {
          const offsetMs = (templateDueSec - templateIssueSec) * 1000
          dueDate = Timestamp.fromDate(new Date(Date.now() + offsetMs))
        }
      }

      // Create new draft invoice
      const invoiceDoc = {
        orgId: template.orgId,
        invoiceNumber,
        pdfShareToken: generateInvoicePdfShareToken(),
        status: 'draft' as const,
        issueDate: FieldValue.serverTimestamp(),
        dueDate,
        lineItems: template.lineItems,
        subtotal: template.subtotal,
        taxRate: template.taxRate,
        taxAmount: template.taxAmount,
        total: template.total,
        currency: template.currency,
        notes: template.notes ?? '',
        fromDetails: template.fromDetails ?? null,
        clientDetails: template.clientDetails ?? null,
        paidAt: null,
        sentAt: null,
        recurringScheduleId: scheduleDoc.id,
        createdBy: 'cron',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }

      // Calculate next due date
      const lastDue: Date = schedule.nextDueAt.toDate()
      const nextDue = calculateNextDueAt(schedule.interval as RecurrenceInterval, lastDue)
      const nextDueTs = Timestamp.fromDate(nextDue)

      // Check if schedule should complete (endDate passed)
      const endDate: Date | null = schedule.endDate?.toDate() ?? null
      const isComplete = endDate !== null && nextDue > endDate

      // Atomic write: create invoice + update schedule together
      const invoiceRef = adminDb.collection('invoices').doc()
      const batch = adminDb.batch()
      batch.set(invoiceRef, invoiceDoc)
      batch.update(scheduleDoc.ref, {
        nextDueAt: nextDueTs,
        status: isComplete ? 'completed' : 'active',
        updatedAt: FieldValue.serverTimestamp(),
      })
      await batch.commit()

      created++
    } catch (err) {
      errors.push(`schedule ${scheduleDoc.id}: ${String(err)}`)
    }
  }

  // --- Overdue invoice sweep ---------------------------------------------
  //
  // Any invoice that is `sent`, `viewed`, or `payment_pending_verification`
  // with a past dueDate should flip to `overdue`. We run three separate
  // queries (Firestore doesn't support `in` + range together without an
  // index per permutation, and doing it this way keeps the index footprint
  // predictable — one composite per status).
  const overdueStatuses: Array<'sent' | 'viewed' | 'payment_pending_verification'> = [
    'sent',
    'viewed',
    'payment_pending_verification',
  ]

  for (const status of overdueStatuses) {
    try {
      const overdueSnap = await (adminDb.collection('invoices') as any)
        .where('status', '==', status)
        .where('dueDate', '<', now)
        .get()

      for (const doc of overdueSnap.docs) {
        try {
          const invoice = doc.data() ?? {}
          const invoiceNumber: string = invoice.invoiceNumber ?? doc.id
          const createdBy: string | undefined = invoice.createdBy
          const orgId: string | undefined = invoice.orgId

          await doc.ref.update({
            status: 'overdue',
            markedOverdueAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: 'cron',
            updatedByType: 'system',
          })

          if (createdBy) {
            await adminDb.collection('notifications').add({
              orgId: orgId ?? null,
              userId: createdBy,
              agentId: null,
              type: 'invoice.overdue',
              title: 'Invoice overdue',
              body: `Invoice ${invoiceNumber} is past its due date`,
              link: `/portal/invoicing/${doc.id}`,
              status: 'unread',
              priority: 'high',
              createdAt: FieldValue.serverTimestamp(),
            })
          }

          if (orgId) {
            const dueDateMs =
              invoice.dueDate?._seconds != null
                ? invoice.dueDate._seconds * 1000
                : invoice.dueDate?.toDate
                  ? invoice.dueDate.toDate().getTime()
                  : null
            const daysOverdue =
              dueDateMs != null
                ? Math.floor((Date.now() - dueDateMs) / (24 * 60 * 60 * 1000))
                : null
            try {
              await dispatchWebhook(orgId, 'invoice.overdue', {
                id: doc.id,
                invoiceNumber,
                total: invoice.total,
                dueDate: invoice.dueDate ?? null,
                daysOverdue,
              })
            } catch (err) {
              console.error('[webhook-dispatch-error] invoice.overdue', err)
            }
          }

          markedOverdue++
        } catch (err) {
          errors.push(`invoice ${doc.id}: ${String(err)}`)
        }
      }
    } catch (err) {
      errors.push(`overdue-query(${status}): ${String(err)}`)
    }
  }

  return apiSuccess({ created, markedOverdue, errors })
}
