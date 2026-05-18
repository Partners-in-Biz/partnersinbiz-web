/**
 * GET /api/v1/crm/reports/funnel
 * Returns contact counts grouped by type and stage for the org.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Contact, ContactType, ContactStage } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

const CONTACT_TYPES: ContactType[] = ['lead', 'prospect', 'client', 'churned']

export const GET = withCrmAuth('member', async (_req, ctx) => {
  const { orgId } = ctx

  try {
    const snap = await adminDb
      .collection('contacts')
      .where('orgId', '==', orgId)
      .where('deleted', '==', false)
      .get()

    const contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Contact[]

    // Group by type
    const byType: Record<ContactType | 'other', number> = {
      lead: 0,
      prospect: 0,
      client: 0,
      churned: 0,
      other: 0,
    }
    for (const c of contacts) {
      if (CONTACT_TYPES.includes(c.type)) {
        byType[c.type]++
      } else {
        byType.other++
      }
    }

    // Group by stage
    const byStage: Record<string, number> = {}
    for (const c of contacts) {
      const stage: ContactStage | string = c.stage ?? 'unknown'
      byStage[stage] = (byStage[stage] ?? 0) + 1
    }

    return apiSuccess({ byType, byStage, total: contacts.length })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
