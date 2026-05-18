// app/api/v1/ads/custom-audiences/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCustomAudience, updateCustomAudience, deleteCustomAudience } from '@/lib/ads/custom-audiences/store'
import { requireMetaContext, resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import type { UpdateAdCustomAudienceInput } from '@/lib/ads/types'
import { logCustomAudienceActivity } from '@/lib/ads/activity'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const ca = await getCustomAudience(id)

    if (!ca) return apiError('Custom audience not found', 404)
    if (ca.orgId !== orgId) return apiError('Custom audience not found', 404) // tenant isolation

    return apiSuccess(ca)
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const ca = await getCustomAudience(id)
    if (!ca || ca.orgId !== orgId) return apiError('Custom audience not found', 404)

    const patch = (await req.json()) as UpdateAdCustomAudienceInput
    await updateCustomAudience(id, patch)

    const updated = await getCustomAudience(id)
    return apiSuccess(updated)
  },
)

export const DELETE = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const ca = await getCustomAudience(id)
    if (!ca || ca.orgId !== orgId) return apiError('Custom audience not found', 404)

    // Best-effort provider delete first
    if (ca.platform === 'linkedin') {
      const providerData = ca.providerData as Record<string, unknown>
      const linkedinData = providerData?.linkedin as Record<string, unknown> | undefined
      const segmentUrn = typeof linkedinData?.dmpSegmentUrn === 'string' ? linkedinData.dmpSegmentUrn : undefined
      if (segmentUrn) {
        try {
          const conn = await getConnection({ orgId, platform: 'linkedin' })
          if (conn) {
            const accessToken = decryptAccessToken(conn)
            const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
            const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
            if (accountUrn) {
              const { archiveAudience } = await import('@/lib/ads/providers/linkedin/audiences')
              await archiveAudience({ accountUrn, accessToken, segmentUrn })
            }
          }
        } catch {
          // swallow — local delete is source of truth
        }
      }
    } else if (ca.platform === 'google') {
      // Google: dispatch to the appropriate remove helper based on subtype
      const providerData = ca.providerData as Record<string, unknown>
      const googleData = providerData?.google as Record<string, unknown> | undefined
      const subtype = googleData?.subtype as string | undefined
      const userListResourceName = googleData?.userListResourceName as string | undefined

      const isPredefined =
        subtype === 'AFFINITY' || subtype === 'IN_MARKET' || subtype === 'DETAILED_DEMOGRAPHICS'

      if (!isPredefined && userListResourceName) {
        try {
          const conn = await getConnection({ orgId, platform: 'google' })
          if (conn) {
            const accessToken = decryptAccessToken(conn)
            const developerToken = readDeveloperToken()
            const customerCtx = resolveGoogleAdsCustomerContext(conn)

            if (!(customerCtx instanceof Response) && developerToken) {
              const callArgs = { ...customerCtx, accessToken, developerToken, resourceName: userListResourceName }
              if (subtype === 'CUSTOMER_MATCH') {
                const { removeCustomerMatchList } = await import('@/lib/ads/providers/google/audiences/customer-match')
                await removeCustomerMatchList(callArgs)
              } else if (subtype === 'REMARKETING') {
                const { removeRemarketingList } = await import('@/lib/ads/providers/google/audiences/remarketing')
                await removeRemarketingList(callArgs)
              } else if (subtype === 'CUSTOM_SEGMENT') {
                const { removeCustomSegment } = await import('@/lib/ads/providers/google/audiences/custom-segments')
                await removeCustomSegment(callArgs)
              }
            }
          }
        } catch {
          // swallow — local delete is source of truth
        }
      }
    } else {
      // Meta: best-effort delete
      const metaCaId = ca.providerData?.meta?.customAudienceId
      if (metaCaId) {
        const ctx = await requireMetaContext(req)
        if (!(ctx instanceof Response)) {
          try {
            await metaProvider.customAudienceCRUD!({
              op: 'delete',
              accessToken: ctx.accessToken,
              metaCaId,
            })
          } catch {
            // swallow — local delete is source of truth
          }
        }
      }
    }

    await deleteCustomAudience(id)

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logCustomAudienceActivity({
      orgId,
      actor,
      action: 'deleted',
      audienceId: id,
      audienceName: ca.name,
      audienceType: ca.type,
    })

    return apiSuccess({ deleted: true })
  },
)
