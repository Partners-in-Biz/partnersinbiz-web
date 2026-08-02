/**
 * Best-effort inbound mailbox → ContactFact proposals.
 * Matches From email to org contacts, then runs local signature/reply parse.
 * Never throws into sync paths; no third-party body egress.
 */
import { adminDb } from '@/lib/firebase/admin'
import { findOrgContactsByEmails } from '@/lib/mailbox/linkMailboxSendToContacts'

export type ApplyInboundMailboxFactsInput = {
  orgId: string
  fromEmail?: string | null
  fromName?: string | null
  bodyText?: string | null
  sourceUrl?: string | null
  agentId?: string
  /** Cap contacts touched per message (default 3). */
  maxContacts?: number
}

export type ApplyInboundMailboxFactsResult = {
  contactIds: string[]
  candidateCount: number
  storedCount: number
  appliedCount: number
}

export async function applyInboundMailboxFactsForMatchedContacts(
  input: ApplyInboundMailboxFactsInput,
): Promise<ApplyInboundMailboxFactsResult> {
  const empty: ApplyInboundMailboxFactsResult = {
    contactIds: [],
    candidateCount: 0,
    storedCount: 0,
    appliedCount: 0,
  }

  try {
    const orgId = String(input.orgId || '').trim()
    const bodyText = String(input.bodyText || '').trim()
    const fromEmail = String(input.fromEmail || '').trim().toLowerCase()
    if (!orgId || !bodyText || !fromEmail || !fromEmail.includes('@')) return empty

    const matches = await findOrgContactsByEmails(orgId, [fromEmail])
    if (matches.length === 0) return empty

    const maxContacts = Math.min(Math.max(input.maxContacts ?? 3, 1), 5)
    const { applyMailboxFactsToContact } = await import('@/lib/crm/facts/apply-mailbox')

    let candidateCount = 0
    let storedCount = 0
    let appliedCount = 0
    const contactIds: string[] = []

    for (const match of matches.slice(0, maxContacts)) {
      try {
        const snap = await adminDb.collection('contacts').doc(match.contactId).get()
        if (!snap.exists) continue
        const data = snap.data()!
        if (data.orgId !== orgId || data.deleted === true) continue

        const result = await applyMailboxFactsToContact({
          orgId,
          contact: { id: snap.id, orgId, ...data },
          bodyText,
          fromName: input.fromName ?? match.name ?? null,
          fromEmail,
          direction: 'inbound',
          agentId: input.agentId ?? 'mailbox-inbound',
          sourceUrl: input.sourceUrl ?? null,
        })

        contactIds.push(match.contactId)
        candidateCount += result.candidateCount
        storedCount += result.storedCount
        appliedCount += result.results.filter((r) => r.result.applied).length
      } catch (err) {
        console.error('[mailbox-inbound-facts] contact failed', match.contactId, err)
      }
    }

    return { contactIds, candidateCount, storedCount, appliedCount }
  } catch (err) {
    console.error('[mailbox-inbound-facts] pipeline failed', err)
    return empty
  }
}
