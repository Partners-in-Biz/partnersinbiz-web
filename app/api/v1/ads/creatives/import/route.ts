import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { createCreative } from '@/lib/ads/creatives/store'
import type {
  AdCreativeSourceType,
  AdCreativeType,
  CreateAdCreativeInput,
} from '@/lib/ads/types'

export const dynamic = 'force-dynamic'

type ImportableSourceType = Extract<AdCreativeSourceType, 'content_asset' | 'content_package' | 'social_post' | 'campaign_asset'>

type RawSourceDoc = Record<string, unknown> & {
  orgId?: string
  status?: string
  approvalStatus?: string
  approvedAt?: unknown
  approvedBy?: string | null
  sourceVersionId?: string
  versionId?: string
  sourceOrgId?: string
  projectId?: string
  approvalTaskId?: string
  approvalDocumentId?: string
  approvalVersionId?: string
  approvalCommentId?: string
  thumbnailUrl?: string
  videoCoverUrl?: string
  coverUrl?: string
  placementSuitability?: unknown
  specValidation?: unknown
  content?: string | { text?: string; headline?: string; description?: string }
  copy?: string | { primaryText?: string; headline?: string; description?: string }
  caption?: string
  text?: string
  title?: string
  landingUrl?: string
  destinationUrl?: string
  url?: string
  utm?: Record<string, unknown>
  utmDefaults?: Record<string, unknown>
  media?: unknown[]
  assets?: unknown[]
  asset?: unknown
}

type RawAsset = Record<string, unknown> & {
  type?: string
  name?: string
  alt?: string
  url?: string
  sourceUrl?: string
  assetUrl?: string
  mediaUrl?: string
  storagePath?: string
  mimeType?: string
  fileSize?: number
  width?: number
  height?: number
  duration?: number
}

const SOURCE_COLLECTIONS: Record<ImportableSourceType, string> = {
  content_asset: 'content_assets',
  content_package: 'content_assets',
  social_post: 'social_posts',
  campaign_asset: 'campaign_assets',
}

const APPROVED_STATUSES = new Set(['approved', 'published', 'vaulted', 'ready_for_ads'])

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeUtm(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => [key, cleanString(value)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
}

function extractCopy(source: RawSourceDoc): string | undefined {
  const copy = source.copy
  if (copy && typeof copy === 'object') return cleanString(copy.primaryText) ?? cleanString(copy.headline)
  if (typeof copy === 'string') return cleanString(copy)

  const content = source.content
  if (content && typeof content === 'object') return cleanString(content.text) ?? cleanString(content.headline)
  if (typeof content === 'string') return cleanString(content)

  return cleanString(source.caption) ?? cleanString(source.text) ?? cleanString(source.title)
}

function extractHeadline(source: RawSourceDoc): string | undefined {
  const copy = source.copy
  if (copy && typeof copy === 'object') return cleanString(copy.headline)
  const content = source.content
  if (content && typeof content === 'object') return cleanString(content.headline)
  return cleanString(source.title)
}

function extractDescription(source: RawSourceDoc): string | undefined {
  const copy = source.copy
  if (copy && typeof copy === 'object') return cleanString(copy.description)
  const content = source.content
  if (content && typeof content === 'object') return cleanString(content.description)
  return undefined
}

function extractAsset(source: RawSourceDoc, assetIndex: number): RawAsset | null {
  const candidates = Array.isArray(source.media)
    ? source.media
    : Array.isArray(source.assets)
      ? source.assets
      : source.asset
        ? [source.asset]
        : []
  const candidate = candidates[assetIndex]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as RawAsset
    : null
}

function inferCreativeType(asset: RawAsset): AdCreativeType | null {
  const explicit = cleanString(asset.type)?.toLowerCase()
  if (explicit === 'image' || explicit === 'video' || explicit === 'carousel_card') return explicit
  const mime = cleanString(asset.mimeType)?.toLowerCase()
  if (mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  return null
}

function isApproved(source: RawSourceDoc): boolean {
  const status = cleanString(source.status)?.toLowerCase()
  const approvalStatus = cleanString(source.approvalStatus)?.toLowerCase()
  return Boolean(source.approvedAt) || Boolean(status && APPROVED_STATUSES.has(status)) || approvalStatus === 'approved'
}

function isImportableSourceType(value: unknown): value is ImportableSourceType {
  return value === 'content_asset' || value === 'content_package' || value === 'social_post' || value === 'campaign_asset'
}

function jsonObjectOrArray<T>(value: unknown): T | undefined {
  return value && typeof value === 'object' ? value as T : undefined
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const sourceType = body.sourceType
  const sourceId = cleanString(body.sourceId)
  const assetIndex = typeof body.assetIndex === 'number' && body.assetIndex >= 0 ? Math.floor(body.assetIndex) : 0

  if (!isImportableSourceType(sourceType) || !sourceId) {
    return apiError('Missing required fields: sourceType, sourceId', 400)
  }

  const collection = SOURCE_COLLECTIONS[sourceType]
  const sourceSnap = await adminDb.collection(collection).doc(sourceId).get()
  if (!sourceSnap.exists) return apiError('Source asset not found', 404)

  const source = sourceSnap.data() as RawSourceDoc
  if (source.orgId !== orgId) {
    return apiError('Source asset belongs to a different org', 403)
  }

  if (!isApproved(source)) {
    return apiError('Source asset must be approved before importing into Ads', 403)
  }

  const asset = extractAsset(source, assetIndex)
  const creativeType = asset ? inferCreativeType(asset) : null
  const sourceUrl = asset ? cleanString(asset.sourceUrl) ?? cleanString(asset.url) ?? cleanString(asset.assetUrl) ?? cleanString(asset.mediaUrl) : undefined
  const storagePath = asset ? cleanString(asset.storagePath) : undefined
  const mimeType = asset ? cleanString(asset.mimeType) : undefined
  const fileSize = asset && typeof asset.fileSize === 'number' ? asset.fileSize : undefined
  const copy = extractCopy(source)
  const landingUrl = cleanString(source.landingUrl) ?? cleanString(source.destinationUrl) ?? cleanString(source.url)
  const utm = normalizeUtm(source.utm ?? source.utmDefaults)
  const videoCoverUrl = cleanString(source.videoCoverUrl) ?? cleanString(source.coverUrl) ?? (creativeType === 'video' ? cleanString(asset?.mediaUrl) : undefined)

  if (!asset || !creativeType || !sourceUrl || !storagePath || !mimeType || typeof fileSize !== 'number' || !copy || !landingUrl || Object.keys(utm).length === 0) {
    return apiError('Missing required approved source fields: asset, copy, landingUrl, UTM snapshot, sourceUrl, storagePath, mimeType, fileSize', 400)
  }

  if (creativeType === 'video' && (typeof asset.duration !== 'number' || !videoCoverUrl)) {
    return apiError('Missing required approved video metadata: duration and videoCoverUrl', 400)
  }

  const input: CreateAdCreativeInput = {
    type: creativeType,
    name: cleanString(body.name) ?? cleanString(asset.name) ?? cleanString(asset.alt) ?? extractHeadline(source) ?? `${sourceType}:${sourceId}`,
    storagePath,
    sourceUrl,
    mimeType,
    fileSize,
    width: typeof asset.width === 'number' ? asset.width : undefined,
    height: typeof asset.height === 'number' ? asset.height : undefined,
    duration: typeof asset.duration === 'number' ? asset.duration : undefined,
    status: 'READY',
    copy: {
      primaryText: copy,
      headline: extractHeadline(source) ?? cleanString(asset.name) ?? cleanString(asset.alt) ?? copy.slice(0, 80),
      description: extractDescription(source),
      destinationUrl: landingUrl,
    },
    source: {
      type: sourceType,
      id: sourceId,
      collection,
      assetIndex,
      approvedAt: source.approvedAt as never,
      approvedBy: source.approvedBy ?? null,
      snapshot: {
        copy,
        landingUrl,
        utm,
        asset: {
          type: creativeType,
          name: cleanString(asset.name) ?? cleanString(asset.alt) ?? `${sourceType}:${sourceId}`,
          sourceUrl,
          storagePath,
          mimeType,
          fileSize,
          width: typeof asset.width === 'number' ? asset.width : undefined,
          height: typeof asset.height === 'number' ? asset.height : undefined,
          duration: typeof asset.duration === 'number' ? asset.duration : undefined,
        },
      },
    },
    sourceType,
    sourceId,
    sourceVersionId: cleanString(source.sourceVersionId) ?? cleanString(source.versionId),
    sourceOrgId: orgId,
    projectId: cleanString(source.projectId),
    approvalStatus: 'approved',
    approvalTaskId: cleanString(source.approvalTaskId),
    approvalDocumentId: cleanString(source.approvalDocumentId),
    approvalVersionId: cleanString(source.approvalVersionId),
    approvalCommentId: cleanString(source.approvalCommentId),
    landingUrl,
    utmDefaults: utm,
    thumbnailUrl: cleanString(source.thumbnailUrl) ?? (creativeType === 'image' ? sourceUrl : undefined),
    videoCoverUrl,
    placementSuitability: jsonObjectOrArray(source.placementSuitability),
    specValidation: jsonObjectOrArray(source.specValidation),
  }

  const created = await createCreative({
    orgId,
    createdBy: (user as { uid?: string }).uid ?? 'unknown',
    input,
  })

  return apiSuccess(created, 201)
})
