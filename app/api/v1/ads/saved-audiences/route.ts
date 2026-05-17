import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listSavedAudiences, createSavedAudience, setSavedAudienceMetaId, getSavedAudience } from '@/lib/ads/saved-audiences/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { adminDb } from '@/lib/firebase/admin'
import type { CreateAdSavedAudienceInput } from '@/lib/ads/types'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  const sas = await listSavedAudiences({ orgId })
  return apiSuccess(sas)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const rawBody = (await req.json()) as { platform?: string }

  // ─── LinkedIn branch ──────────────────────────────────────────────────────
  if (rawBody.platform === 'linkedin') {
    const body = rawBody as {
      platform: 'linkedin'
      name?: string
      targeting?: unknown
      description?: string
    }

    if (!body.name) return apiError('name is required', 400)
    if (!body.targeting || typeof body.targeting !== 'object') return apiError('targeting object is required', 400)

    const conn = await getConnection({ orgId, platform: 'linkedin' })
    if (!conn) return apiError('No LinkedIn ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
    const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
    if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

    let result: { urn: string; id: string }
    try {
      const { createSavedAudience: createLinkedinSavedAudience } = await import('@/lib/ads/providers/linkedin/saved-audiences')
      result = await createLinkedinSavedAudience({
        accountUrn,
        accessToken,
        name: body.name,
        targeting: body.targeting as any, // LinkedinTargetingCriteria — caller responsibility to validate shape
      })
    } catch (err) {
      return apiError(`LinkedIn saved audience create failed: ${(err as Error).message}`, 500)
    }

    const sa = await createSavedAudience({
      orgId,
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      platform: 'linkedin',
      input: {
        name: body.name,
        description: body.description ?? '',
        targeting: {} as any, // canonical AdTargeting may be empty; LI-specific lives in providerData
      } as CreateAdSavedAudienceInput,
    })

    await adminDb.collection('saved_audiences').doc(sa.id).update({
      providerData: { linkedin: { audienceTemplateUrn: result.urn } },
    })

    const updated = await getSavedAudience(sa.id)
    return apiSuccess(updated, 201)
  }

  // ─── Meta branch (existing, unchanged) ────────────────────────────────────
  const ctx = await requireMetaContext(req)
  if (ctx instanceof Response) return ctx
  const body = rawBody as { input?: CreateAdSavedAudienceInput }
  if (!body.input?.name || !body.input?.targeting) {
    return apiError('Missing required fields: name, targeting', 400)
  }

  const sa = await createSavedAudience({
    orgId: ctx.orgId,
    createdBy: (user as { uid?: string }).uid ?? 'unknown',
    input: body.input,
  })

  try {
    const result = await metaProvider.savedAudienceCRUD!({
      op: 'create',
      accessToken: ctx.accessToken,
      adAccountId: ctx.adAccountId,
      sa,
    })
    const metaSavId = (result as { metaSavId: string }).metaSavId
    await setSavedAudienceMetaId(sa.id, metaSavId)
    const updated = await getSavedAudience(sa.id)
    return apiSuccess(updated, 201)
  } catch (err) {
    return apiError(`Meta sync failed: ${(err as Error).message}`, 500)
  }
})
