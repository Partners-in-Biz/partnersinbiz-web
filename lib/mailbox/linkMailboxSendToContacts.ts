/**
 * After a mailbox send succeeds, link it to matching CRM contacts:
 * - activity rows with contactId (for contact timelines)
 * - lastContactedAt on each matched contact
 *
 * Best-effort only — never throw into the send path.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export type MailboxSendContactLinkInput = {
  orgId: string
  uid: string
  accountId: string
  mailboxMessageId: string
  provider: 'google' | 'smtp'
  providerMessageId?: string | null
  threadId?: string | null
  subject: string
  bodySnippet?: string
  to: string[]
  cc?: string[]
  /** BCC intentionally excluded — private recipients should not create CRM touches. */
  actorId?: string
  actorType?: 'user' | 'agent' | 'system'
}

export type MatchedMailboxContact = {
  contactId: string
  email: string
  companyId?: string
  name?: string
}

export function normalizeRecipientEmails(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values ?? []) {
    const email = String(raw ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) continue
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

/** Unique to+cc addresses for CRM matching (no bcc). */
export function recipientEmailsForCrmTouch(input: { to: string[]; cc?: string[] }): string[] {
  return normalizeRecipientEmails([...input.to, ...(input.cc ?? [])])
}

export async function findOrgContactsByEmails(
  orgId: string,
  emails: string[],
): Promise<MatchedMailboxContact[]> {
  if (!orgId.trim() || emails.length === 0) return []

  const matches: MatchedMailboxContact[] = []
  const seenContactIds = new Set<string>()

  // Sequential queries keep the mockable shape simple and avoid large `in` limits.
  // Cap to protect send latency (typical sends have 1–3 recipients).
  for (const email of emails.slice(0, 12)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = await (adminDb.collection('contacts') as any)
        .where('orgId', '==', orgId)
        .where('email', '==', email)
        .limit(3)
        .get()

      for (const doc of snap.docs as Array<{ id: string; data: () => Record<string, unknown> }>) {
        const data = doc.data() ?? {}
        if (data.deleted === true) continue
        if (data.orgId !== orgId) continue
        if (seenContactIds.has(doc.id)) continue
        seenContactIds.add(doc.id)
        const companyId = typeof data.companyId === 'string' && data.companyId.trim()
          ? data.companyId.trim()
          : undefined
        const name = typeof data.name === 'string' ? data.name.trim() : undefined
        matches.push({
          contactId: doc.id,
          email,
          ...(companyId ? { companyId } : {}),
          ...(name ? { name } : {}),
        })
      }
    } catch {
      // Continue other recipients.
    }
  }

  return matches
}

/**
 * Resolve recipients → contacts, write timeline activities, bump lastContactedAt.
 * Returns matched contact ids (empty if none / on failure).
 */
export async function linkMailboxSendToContacts(
  input: MailboxSendContactLinkInput,
): Promise<{ contactIds: string[]; activityIds: string[] }> {
  const emails = recipientEmailsForCrmTouch({ to: input.to, cc: input.cc })
  if (emails.length === 0) return { contactIds: [], activityIds: [] }

  let matches: MatchedMailboxContact[]
  try {
    matches = await findOrgContactsByEmails(input.orgId, emails)
  } catch {
    return { contactIds: [], activityIds: [] }
  }
  if (matches.length === 0) return { contactIds: [], activityIds: [] }

  const now = FieldValue.serverTimestamp()
  const actorId = input.actorId ?? input.uid
  const subject = (input.subject || '(no subject)').trim()
  const summary = `Email sent: ${subject}`.slice(0, 500)
  const activityIds: string[] = []
  const contactIds: string[] = []

  for (const match of matches) {
    try {
      const metadata: Record<string, unknown> = {
        source: 'mailbox_send_bridge',
        mailboxMessageId: input.mailboxMessageId,
        provider: input.provider,
        providerMessageId: input.providerMessageId ?? null,
        threadId: input.threadId ?? null,
        accountId: input.accountId,
        to: match.email,
        recipients: emails,
        actorType: input.actorType ?? 'user',
      }
      if (input.bodySnippet) metadata.bodySnippet = input.bodySnippet.slice(0, 300)

      const activityRef = await adminDb.collection('activities').add({
        orgId: input.orgId,
        contactId: match.contactId,
        dealId: '',
        ...(match.companyId ? { companyId: match.companyId } : {}),
        type: 'email_sent',
        summary,
        note: input.bodySnippet?.slice(0, 500) ?? '',
        metadata,
        source: 'mailbox_send_bridge',
        mailboxMessageId: input.mailboxMessageId,
        provider: input.provider,
        providerMessageId: input.providerMessageId ?? null,
        threadId: input.threadId ?? null,
        subject,
        createdBy: actorId,
        createdByRef: {
          uid: actorId,
          type: input.actorType ?? 'user',
        },
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })
      activityIds.push(activityRef.id)
      contactIds.push(match.contactId)

      await adminDb.collection('contacts').doc(match.contactId).update({
        lastContactedAt: now,
        updatedAt: now,
      })
    } catch {
      // Best-effort per contact.
    }
  }

  // Stamp matched contact ids on the sent mailbox message for audit/deep-links.
  if (contactIds.length > 0) {
    try {
      await adminDb.collection('mailbox_messages').doc(input.mailboxMessageId).set({
        linkedContactIds: contactIds,
        crmLinkedAt: now,
        updatedAt: now,
      }, { merge: true })
    } catch {
      // Non-fatal.
    }
  }

  return { contactIds, activityIds }
}
