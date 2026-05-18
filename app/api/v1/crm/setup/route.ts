import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCrmSetupState, saveCrmSetupState } from '@/lib/crm/setup/store'
import { CRM_STARTER_TEMPLATES } from '@/lib/crm/setup/templates'

export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  const setup = await getCrmSetupState(ctx.orgId)
  return apiSuccess({ setup, templates: CRM_STARTER_TEMPLATES })
})

export const PUT = withCrmAuth('member', async (req, ctx) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const setup = await saveCrmSetupState(ctx.orgId, body, ctx.actor)
  return apiSuccess({ setup })
})
