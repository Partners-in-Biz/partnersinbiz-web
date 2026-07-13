import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { estimateAudienceDefinition } from '@/lib/email-marketing/audience-resolver'
import { sanitizeAudienceDefinition } from '@/lib/email-marketing/audience-snapshot'

export const dynamic = 'force-dynamic'

export const POST = withAuth('client', withTenant(async (req, _user, orgId) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  try {
    const definition = sanitizeAudienceDefinition(body.definition ?? body)
    const programId = typeof body.programId === 'string' ? body.programId.trim() : ''
    const estimate = await estimateAudienceDefinition(orgId, definition, {
      holdoutSeed: programId || `org:${orgId}`,
    })
    return apiSuccess({ definition, estimate })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Unable to estimate audience', 400)
  }
}))
