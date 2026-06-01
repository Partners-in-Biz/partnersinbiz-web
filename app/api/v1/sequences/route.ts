// app/api/v1/sequences/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

type FirestoreDoc = { id: string; data: () => Record<string, unknown> }
type SequenceListRow = Record<string, unknown> & {
  id: string
  deleted?: boolean
  status?: string
  createdAt?: unknown
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate._seconds === 'number') return candidate._seconds * 1000
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const requestedOrgId = searchParams.get('orgId') ?? (user.role === 'admin' || user.role === 'ai' ? PIB_PLATFORM_ORG_ID : null)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  // Keep Firestore index-safe: tenant equality in Firestore, secondary filters
  // and sorting in memory.
  const query = adminDb.collection('sequences').where('orgId', '==', orgId)

  const snap = await query.get()
  const docs = snap.docs as FirestoreDoc[]

  // Filter soft-deleted docs in memory (avoids composite index requirement)
  let data = docs
    .map((d): SequenceListRow => ({ id: d.id, ...d.data() }))
    .filter((d) => d.deleted !== true && (!status || d.status === status))
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
  const total = data.length
  data = data.slice((page - 1) * limit, page * limit)

  return apiSuccess(data, 200, { total, page, limit })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body?.name) return apiError('name is required', 400)

  const requestedOrgId =
    typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : user.role === 'admin' || user.role === 'ai'
        ? PIB_PLATFORM_ORG_ID
        : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const ref = await adminDb.collection('sequences').add({
    orgId,
    name: body.name,
    description: body.description ?? '',
    status: body.status ?? 'draft',
    steps: body.steps ?? [],
    topicId:
      typeof body.topicId === 'string' && body.topicId.trim()
        ? body.topicId.trim()
        : 'newsletter',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  return apiSuccess({ id: ref.id, ...body }, 201)
})
