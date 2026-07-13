import { adminDb } from '@/lib/firebase/admin'
import type { Contact } from '@/lib/crm/types'
import type { EmailSenderPolicy, SenderRecipientContext } from '@/lib/email-marketing/sender-types'

function memberUid(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const uid = (value as { uid?: unknown }).uid
  return typeof uid === 'string' ? uid.trim() || null : null
}

/**
 * Builds the CRM ownership inputs used by deterministic sender resolution.
 * Every related record is checked against the same organisation before its
 * owner can influence the selected identity.
 */
export async function buildSenderRecipientContext(
  orgId: string,
  contact: Contact,
  policy: EmailSenderPolicy,
): Promise<SenderRecipientContext> {
  const recipient: SenderRecipientContext = {
    contactId: contact.id,
    contactOwnerUid: memberUid(contact.assignedTo) ?? memberUid(contact.assignedToRef),
    companyId: contact.companyId ?? null,
  }

  if (policy.strategy === 'company_account_manager' && contact.companyId) {
    const companySnap = await adminDb.collection('companies').doc(contact.companyId).get()
    if (companySnap.exists) {
      const company = companySnap.data() as Record<string, unknown>
      if (company.orgId === orgId && !company.deleted) {
        recipient.companyAccountManagerUid =
          memberUid(company.accountManagerUid) ?? memberUid(company.ownerUid) ?? memberUid(company.assignedTo)
      }
    }
  }

  if (policy.strategy === 'deal_owner') {
    const deals = await adminDb
      .collection('deals')
      .where('orgId', '==', orgId)
      .where('contactId', '==', contact.id)
      .limit(1)
      .get()
    const dealDoc = deals.docs[0]
    if (dealDoc) {
      const deal = dealDoc.data() as Record<string, unknown>
      if (!deal.deleted) {
        recipient.dealId = dealDoc.id
        recipient.dealOwnerUid = memberUid(deal.ownerUid) ?? memberUid(deal.ownerRef) ?? memberUid(deal.assignedTo)
      }
    }
  }

  return recipient
}
