import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { estimateAudienceDefinition } from '@/lib/email-marketing/audience-resolver'
import { sanitizeAudienceDefinition } from '@/lib/email-marketing/audience-snapshot'
import {
  createAudienceVersion,
  getAudienceVersions,
} from '@/lib/email-marketing/audience-version-store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (req, _user, orgId) => {
  const programId = new URL(req.url).searchParams.get('programId')?.trim() || undefined
  const versions = await getAudienceVersions(orgId, programId)
  return apiSuccess(versions, 200, { total: versions.length })
}))

export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }
  const programId = typeof body.programId === 'string' ? body.programId.trim() : ''
  if (!programId) return apiError('programId is required', 400)

  try {
    const definition = sanitizeAudienceDefinition(body.definition)
    // Membership is always resolved server-side at freeze time. The endpoint
    // never trusts a caller-supplied count or contact list.
    const estimate = await estimateAudienceDefinition(orgId, definition, { holdoutSeed: programId })
    const created = await createAudienceVersion({
      orgId,
      programId,
      createdBy: user.uid,
      definition,
      estimate,
    })
    return apiSuccess({ ...created, estimate }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Unable to freeze audience version', 400)
  }
}))
