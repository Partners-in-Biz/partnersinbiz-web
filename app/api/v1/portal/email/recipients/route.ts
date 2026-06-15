import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RecipientSuggestion = {
  id: string
  type: 'contact' | 'company'
  label: string
  email: string
  detail?: string
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : ''
}

function normalizeSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function addRecipient(
  target: RecipientSuggestion[],
  seen: Set<string>,
  recipient: RecipientSuggestion,
  q: string,
) {
  const email = normalizeEmail(recipient.email)
  if (!email || seen.has(email)) return
  const haystack = [recipient.label, email, recipient.detail ?? ''].join(' ').toLowerCase()
  if (q && !haystack.includes(q)) return
  seen.add(email)
  target.push({ ...recipient, email })
}

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, _uid: string, orgId: string) => {
  try {
    const { searchParams } = new URL(req.url)
    const q = normalizeSearch(searchParams.get('q'))
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 30), 1), 50)
    const recipients: RecipientSuggestion[] = []
    const seen = new Set<string>()

    const [contactsSnap, companiesSnap] = await Promise.all([
      adminDb.collection('contacts').where('orgId', '==', orgId).limit(250).get(),
      adminDb.collection('companies').where('orgId', '==', orgId).limit(250).get(),
    ])

    for (const doc of contactsSnap.docs) {
      const data = doc.data()
      if (data.deleted === true) continue
      addRecipient(recipients, seen, {
        id: doc.id,
        type: 'contact',
        label: String(data.name ?? data.email ?? 'Contact'),
        email: String(data.email ?? ''),
        detail: String(data.companyName ?? data.company ?? ''),
      }, q)
      if (recipients.length >= limit) break
    }

    for (const doc of companiesSnap.docs) {
      if (recipients.length >= limit) break
      const data = doc.data()
      if (data.deleted === true) continue
      const companyName = String(data.name ?? data.tradingName ?? data.legalName ?? 'Company')
      const candidates = [
        { email: data.billingEmail, detail: 'Billing email' },
        { email: data.accountsContact?.email, detail: data.accountsContact?.name ? `Accounts: ${data.accountsContact.name}` : 'Accounts contact' },
        { email: data.authorizedSignatory?.email, detail: data.authorizedSignatory?.name ? `Signatory: ${data.authorizedSignatory.name}` : 'Authorized signatory' },
      ]
      for (const candidate of candidates) {
        addRecipient(recipients, seen, {
          id: `${doc.id}:${String(candidate.detail)}`,
          type: 'company',
          label: companyName,
          email: String(candidate.email ?? ''),
          detail: String(candidate.detail ?? ''),
        }, q)
        if (recipients.length >= limit) break
      }
    }

    recipients.sort((a, b) => a.label.localeCompare(b.label) || a.email.localeCompare(b.email))
    return apiSuccess({ recipients: recipients.slice(0, limit) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
