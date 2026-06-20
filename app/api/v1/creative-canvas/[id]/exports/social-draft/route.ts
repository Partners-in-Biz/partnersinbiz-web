import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import { buildSocialDraftFromCanvasOutput } from '@/lib/creative-canvas/exporters/social'
import type { SocialPlatformType } from '@/lib/social/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Malformed JSON body', 400)

  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
  const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return apiError('Creative canvas output node not found', 404)

  const payload = buildSocialDraftFromCanvasOutput({
    orgId,
    canvasId: id,
    node,
    platforms: stringArray(body.platforms) as SocialPlatformType[],
    caption: typeof body.caption === 'string' ? body.caption : undefined,
    hashtags: stringArray(body.hashtags),
    labels: stringArray(body.labels),
    tags: stringArray(body.tags),
  })

  const docRef = await adminDb.collection('social_posts').add({
    ...payload,
    campaign: null,
    campaignId: null,
    scheduledAt: null,
    scheduledFor: null,
    publishedAt: null,
    platformResults: {},
    createdBy: user.uid,
    assignedTo: null,
    approvedBy: null,
    approvedAt: null,
    comments: [],
    threadParts: [],
    category: 'ai',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ postId: docRef.id, draft: payload }, 201)
})
