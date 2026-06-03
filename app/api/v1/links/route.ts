/**
 * GET  /api/v1/links  — list shortened links for the org (paginated)
 * POST /api/v1/links  — create a new shortened link
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { createShortLink } from '@/lib/links/shorten'

export const dynamic = 'force-dynamic'

type TimestampLike = { seconds?: number; toMillis?: () => number } | string | number | null | undefined
type ShortenedLinkRow = { id: string; createdAt?: TimestampLike; [key: string]: unknown }

function linkCreatedAtMillis(value: TimestampLike): number {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      return value.toMillis()
    }

    if (typeof value.seconds === 'number') {
      return value.seconds * 1000
    }
  }

  return 0
}

/**
 * GET /api/v1/links?page=1&limit=20
 * Lists all shortened links for the org with click counts
 */
export const GET = withAuth('client', withTenant(async (req, _user, orgId) => {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = (page - 1) * limit
  const propertyId = searchParams.get('propertyId') || undefined

  let query = adminDb
    .collection('shortened_links')
    .where('orgId', '==', orgId) as FirebaseFirestore.Query

  if (propertyId) {
    query = query.where('propertyId', '==', propertyId)
  }

  const snapshot = await query.get()

  const allLinks = snapshot.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data(),
    }) as ShortenedLinkRow)
    .sort((a, b) => linkCreatedAtMillis(b.createdAt) - linkCreatedAtMillis(a.createdAt))

  const totalCount = allLinks.length
  const links = allLinks
    .slice(offset, offset + limit)

  return apiSuccess(links, 200, {
    total: totalCount,
    page,
    limit,
  })
}))

/**
 * POST /api/v1/links
 * Creates a new shortened link with optional UTM parameters
 *
 * Body:
 *   {
 *     originalUrl: string (required)
 *     utmSource?: string
 *     utmMedium?: string
 *     utmCampaign?: string
 *     utmTerm?: string
 *     utmContent?: string
 *   }
 */
export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  try {
    const body = await req.json()

    // Validate original URL
    if (!body.originalUrl || typeof body.originalUrl !== 'string') {
      return apiError('originalUrl is required and must be a string')
    }

    // Verify it's a valid URL
    try {
      new URL(body.originalUrl)
    } catch {
      return apiError('originalUrl must be a valid URL')
    }

    // Create the shortened link
    const link = await createShortLink(
      orgId,
      body.originalUrl,
      {
        propertyId: typeof body.propertyId === 'string' ? body.propertyId : undefined,
        customShortCode: typeof body.shortCode === 'string' ? body.shortCode : undefined,
        utmSource: body.utmSource,
        utmMedium: body.utmMedium,
        utmCampaign: body.utmCampaign,
        utmTerm: body.utmTerm,
        utmContent: body.utmContent,
      },
      user.uid,
    )

    return apiSuccess(link, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create shortened link'
    return apiError(message, 400)
  }
}))
