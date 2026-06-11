// app/api/v1/ads/creatives/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listCreatives, createCreative } from '@/lib/ads/creatives/store'
import { listAds } from '@/lib/ads/ads/store'
import type { AdCreativeType, AdCreativeStatus, CreateAdCreativeInput } from '@/lib/ads/types'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const type = url.searchParams.get('type') as AdCreativeType | null
  const status = url.searchParams.get('status') as AdCreativeStatus | null
  const used = url.searchParams.get('used')
  const includeArchived = url.searchParams.get('includeArchived') === 'true'

  let creatives = await listCreatives({
    orgId,
    type: type ?? undefined,
    status: status ?? undefined,
    includeArchived,
  })

  if (used === 'true' || used === 'false') {
    const ads = await listAds({ orgId })
    const referencedIds = new Set<string>()
    for (const a of ads) {
      for (const cid of a.creativeIds) {
        referencedIds.add(cid)
      }
    }
    creatives = creatives.filter((c) =>
      used === 'true' ? referencedIds.has(c.id) : !referencedIds.has(c.id),
    )
  }

  return apiSuccess(creatives)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const body = (await req.json()) as Partial<CreateAdCreativeInput>

  if (
    !body.name ||
    !body.type ||
    !body.sourceUrl ||
    !body.storagePath ||
    !body.mimeType ||
    typeof body.fileSize !== 'number'
  ) {
    return apiError(
      'Missing required fields: name, type, sourceUrl, storagePath, mimeType, fileSize',
      400,
    )
  }

  if (body.sourceOrgId && body.sourceOrgId !== orgId) {
    return apiError('sourceOrgId must match X-Org-Id for creative imports', 400)
  }

  const input: CreateAdCreativeInput = {
    type: body.type,
    name: body.name,
    storagePath: body.storagePath,
    sourceUrl: body.sourceUrl,
    mimeType: body.mimeType,
    fileSize: body.fileSize,
    width: body.width,
    height: body.height,
    duration: body.duration,
    status: 'READY',
    copy: body.copy,
    sourceType: body.sourceType,
    sourceId: body.sourceId,
    sourceVersionId: body.sourceVersionId,
    sourceOrgId: body.sourceOrgId ?? orgId,
    projectId: body.projectId,
    approvalStatus: body.approvalStatus,
    approvalTaskId: body.approvalTaskId,
    approvalDocumentId: body.approvalDocumentId,
    approvalVersionId: body.approvalVersionId,
    approvalCommentId: body.approvalCommentId,
    thumbnailUrl: body.thumbnailUrl,
    videoCoverUrl: body.videoCoverUrl,
    landingUrl: body.landingUrl,
    utmDefaults: body.utmDefaults,
    placementSuitability: body.placementSuitability,
    specValidation: body.specValidation,
    supersedes: body.supersedes,
    changeSummary: body.changeSummary,
    usageBacklinks: body.usageBacklinks,
  }

  try {
    const created = await createCreative({
      orgId,
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      input,
    })

    return apiSuccess(created, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create creative'
    if (message.includes('Superseded creative') || message.includes('outside the active org')) {
      return apiError(message, 400)
    }
    throw err
  }
})
