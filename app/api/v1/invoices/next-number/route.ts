// app/api/v1/invoices/next-number/route.ts
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { previewNextInvoiceNumber } from '@/lib/invoices/invoice-number'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { resolvePlatformOwnerOrgId } from '@/lib/platform-owner/relationships'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  // Look up org name
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  const orgName = orgDoc.data()?.name ?? 'Unknown'

  const sourceOrgId = await resolvePlatformOwnerOrgId()
  const invoiceNumber = await previewNextInvoiceNumber(sourceOrgId, orgName)
  return apiSuccess({ invoiceNumber })
})
