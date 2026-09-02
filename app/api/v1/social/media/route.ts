/**
 * GET  /api/v1/social/media  — list uploaded media
 * POST /api/v1/social/media  — register media record
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { MediaType, MediaStatus } from '@/lib/social/providers'
import {
  clientVisibilityFieldsForWrite,
  recordVisibleForWorkScope,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const VALID_TYPES: MediaType[] = ['image', 'video', 'gif']
const VALID_STATUSES: MediaStatus[] = ['uploading', 'processing', 'ready', 'failed']

export const GET = withAuth('admin', withTenant(async (req, user, orgId) => {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') as MediaType | null
  const status = searchParams.get('status') as MediaStatus | null
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const scope = resolveWorkScopeFromSearchParams(searchParams, user.uid)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('social_media').where('orgId', '==', orgId)

  if (type && VALID_TYPES.includes(type)) {
    query = query.where('type', '==', type)
  }

  if (status && VALID_STATUSES.includes(status)) {
    query = query.where('status', '==', status)
  }

  const snapshot = await query.get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMedia = snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  })).filter((m: Record<string, unknown>) => recordVisibleForWorkScope(m, scope))

  const total = allMedia.length
  const start = (page - 1) * limit
  const media = allMedia.slice(start, start + limit)

  return apiSuccess(media, 200, { total, page, limit })
}))

export const POST = withAuth('admin', withTenant(async (req, user, orgId) => {
  const body = await req.json()

  if (!body.originalUrl || typeof body.originalUrl !== 'string') {
    return apiError('originalUrl is required')
  }
  if (!body.originalFilename || typeof body.originalFilename !== 'string') {
    return apiError('originalFilename is required')
  }
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return apiError(`type must be one of: ${VALID_TYPES.join(', ')}`)
  }

  const doc = {
    orgId,
    originalUrl: body.originalUrl,
    originalFilename: body.originalFilename,
    originalMimeType: body.originalMimeType ?? 'application/octet-stream',
    originalSize: body.originalSize ?? 0,
    status: 'ready' as MediaStatus,
    variants: body.variants ?? {},
    thumbnailUrl: body.thumbnailUrl ?? body.originalUrl,
    type: body.type as MediaType,
    width: body.width ?? 0,
    height: body.height ?? 0,
    duration: body.duration ?? null,
    altText: body.altText ?? '',
    usedInPosts: [],
    ...workScopeFieldsForWrite(resolveWorkScopeFromRequest({ searchParams: new URL(req.url).searchParams, body, uid: user.uid })),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
    uploadedBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('social_media').add(doc)

  return apiSuccess({ id: docRef.id }, 201)
}))
