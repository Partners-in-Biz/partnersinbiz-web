import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  type AssignableCrmRecord,
  crmActorCanReadCompanyRecord,
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'
import { resolveBillingCrmAuthContext } from '@/lib/billing/crm-record-scope'
import type { ApiUser } from '@/lib/api/types'

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

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string) => {
  try {
    const { searchParams } = new URL(req.url)
    const q = normalizeSearch(searchParams.get('q'))
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 30), 1), 50)
    const recipients: RecipientSuggestion[] = []
    const seen = new Set<string>()

    const userDoc = await adminDb.collection('users').doc(uid).get()
    const userData = userDoc.data() ?? {}
    const apiUser: ApiUser = {
      uid,
      role: userData.role === 'admin' ? 'admin' : userData.role === 'ai' ? 'ai' : 'client',
      orgId,
      activeOrgId: orgId,
      allowedOrgIds: Array.isArray(userData.allowedOrgIds) ? userData.allowedOrgIds : undefined,
      orgIds: Array.isArray(userData.orgIds) ? userData.orgIds : undefined,
    }
    const crmCtx = await resolveBillingCrmAuthContext(apiUser, orgId)
    const privileged = isCrmPrivilegedActor(crmCtx)

    const [contactsSnap, companiesSnap] = await Promise.all([
      adminDb.collection('contacts').where('orgId', '==', orgId).limit(250).get(),
      adminDb.collection('companies').where('orgId', '==', orgId).limit(250).get(),
    ])

    const contactRows = contactsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as AssignableCrmRecord & {
        name?: unknown
        email?: unknown
        companyName?: unknown
        company?: unknown
      })
      .filter((row) => row.deleted !== true)

    let visibleContacts = contactRows
    if (!privileged) {
      const companyIds = new Set<string>()
      for (const row of contactRows) {
        for (const id of crmRecordCompanyIds(row)) companyIds.add(id)
      }
      const companies = await loadCompanyAssignmentMap(orgId, companyIds)
      visibleContacts = filterCrmRowsForActor(crmCtx, contactRows, { companies }) as typeof contactRows
    }

    for (const data of visibleContacts) {
      addRecipient(recipients, seen, {
        id: String(data.id),
        type: 'contact',
        label: String(data.name ?? data.email ?? 'Contact'),
        email: String(data.email ?? ''),
        detail: String(data.companyName ?? data.company ?? ''),
      }, q)
      if (recipients.length >= limit) break
    }

    for (const doc of companiesSnap.docs) {
      if (recipients.length >= limit) break
      const data = doc.data() as AssignableCrmRecord & {
        name?: unknown
        tradingName?: unknown
        legalName?: unknown
        billingEmail?: unknown
        accountsContact?: { email?: unknown; name?: unknown }
        authorizedSignatory?: { email?: unknown; name?: unknown }
      }
      if (data.deleted === true) continue
      if (!privileged && !(await crmActorCanReadCompanyRecord(crmCtx, doc.id, { id: doc.id, ...data }))) continue
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
