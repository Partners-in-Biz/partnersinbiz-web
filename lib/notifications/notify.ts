// lib/notifications/notify.ts
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email/send'
import { approvalNeededEmail, newCommentEmail, invoiceSentEmail } from '@/lib/email/templates'
import { getOrgManagerEmails } from '@/lib/organizations/manager-emails'

// Base URL for links in emails
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://partnersinbiz.online'

function absoluteAppUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${BASE_URL}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`
}

export async function notifyApprovalNeeded(postId: string, postContent: string, orgId: string) {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return
    const org = orgDoc.data()!
    const notifEmail = org.settings?.notificationEmail
    if (!notifEmail) return

    const html = approvalNeededEmail(postContent, org.name, `${BASE_URL}/portal/social`)
    await sendEmail({ to: notifEmail, subject: `[PIB] Post pending approval - ${org.name}`, html })
  } catch (err) {
    console.error('[Notify] Approval email failed:', err)
  }
}

export async function notifyNewComment(opts: {
  commentText: string
  commenterName: string
  commenterRole: string
  context: string  // "task 'Fix bug'" or "social post"
  orgId?: string
  viewUrl: string
}) {
  try {
    // If commenter is a client → notify admins (Peet)
    // If commenter is admin/ai → notify org's notification email

    if (opts.commenterRole === 'client' && opts.orgId) {
      // Notify whoever is assigned to manage this client in the Teams tab
      const managerEmails = await getOrgManagerEmails(opts.orgId)
      if (managerEmails.length > 0) {
        const html = newCommentEmail(opts.commentText, opts.commenterName, `on ${opts.context}`, absoluteAppUrl(opts.viewUrl))
        await Promise.all(
          managerEmails.map(email =>
            sendEmail({ to: email, subject: `[PIB] New comment on ${opts.context}`, html })
          )
        )
      }
    } else if (opts.orgId) {
      // Notify the client org
      const orgDoc = await adminDb.collection('organizations').doc(opts.orgId).get()
      if (orgDoc.exists) {
        const notifEmail = orgDoc.data()?.settings?.notificationEmail
        if (notifEmail) {
          const html = newCommentEmail(opts.commentText, opts.commenterName, `on ${opts.context}`, absoluteAppUrl(opts.viewUrl))
          await sendEmail({ to: notifEmail, subject: `[PIB] New comment on ${opts.context}`, html })
        }
      }
    }
  } catch (err) {
    console.error('[Notify] Comment email failed:', err)
  }
}

export async function notifyInvoiceSent(invoiceId: string) {
  try {
    const invoiceDoc = await adminDb.collection('invoices').doc(invoiceId).get()
    if (!invoiceDoc.exists) return
    const inv = invoiceDoc.data()!
    if (!inv.orgId) return

    const orgDoc = await adminDb.collection('organizations').doc(inv.orgId).get()
    if (!orgDoc.exists) return
    const org = orgDoc.data()!
    const notifEmail = org.settings?.notificationEmail ?? org.billingEmail
    if (!notifEmail) return

    const total = new Intl.NumberFormat('en', { style: 'currency', currency: inv.currency ?? 'USD' }).format(inv.total)
    const dueDate = inv.dueDate?._seconds
      ? new Date(inv.dueDate._seconds * 1000).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'N/A'

    const html = invoiceSentEmail(inv.invoiceNumber, total, dueDate, org.name, `${BASE_URL}/portal/payments`)
    await sendEmail({ to: notifEmail, subject: `[PIB] Invoice ${inv.invoiceNumber} - ${total}`, html })
  } catch (err) {
    console.error('[Notify] Invoice email failed:', err)
  }
}
