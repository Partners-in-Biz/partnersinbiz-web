import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'
import { isProjectedCompanyMarketing, toMarketingCompanyCard } from '@/lib/companies/marketing-projection'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (_req: NextRequest, _user, orgId) => {
  const homeSnap = await adminDb.collection('companies')
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
    .limit(200)
    .get()

  let linkedDocs: FirebaseFirestore.QueryDocumentSnapshot[] = []
  try {
    const linkedSnap = await adminDb.collection('companies')
      .where('linkedOrgId', '==', orgId)
      .limit(200)
      .get()
    linkedDocs = linkedSnap.docs
  } catch {
    linkedDocs = []
  }

  const byId = new Map<string, ReturnType<typeof toMarketingCompanyCard>>()
  for (const doc of [...homeSnap.docs, ...linkedDocs]) {
    const data = doc.data() ?? {}
    const company = { id: doc.id, ...data }
    if (!isProjectedCompanyMarketing(company, orgId)) continue
    byId.set(doc.id, toMarketingCompanyCard(company))
  }

  const companies = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  return apiSuccess({ companies }, 200, { total: companies.length, orgId })
}))
