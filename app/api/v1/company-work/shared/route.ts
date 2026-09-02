import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'
import { listLinkedCompaniesForViewer, listSharedRecords } from '@/lib/company-work/projection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/company-work/shared?module=seo&companyId=
 * Lists serving-org records projected into the viewer's org.
 */
export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const { searchParams } = new URL(req.url)
    const moduleParam = (searchParams.get('module') || '').trim() as SharedBusinessCapability
    const companyId = searchParams.get('companyId')?.trim() || undefined

    if (!moduleParam) {
      const companies = await listLinkedCompaniesForViewer(ctx.orgId)
      return apiSuccess({ companies })
    }

    if (!(COMPANY_WORKSPACE_MODULES as string[]).includes(moduleParam)) {
      return apiError('Unknown module', 400)
    }

    const records = await listSharedRecords(ctx.orgId, moduleParam, { companyId })
    return apiSuccess({ module: moduleParam, records })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
