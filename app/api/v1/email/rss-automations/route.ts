// app/api/v1/email/rss-automations/route.ts
//
// GET  — list RSS digest automations for the scoped org
// POST — create a new RSS digest automation
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { validateRssAutomationInput } from '@/lib/email/rss-automation'

export const dynamic = 'force-dynamic'

type FirestoreDoc = { id: string; data: () => Record<string, unknown> }

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object') {
    const c = value as { toMillis?: () => number; _seconds?: number; seconds?: number }
    if (typeof c.toMillis === 'function') return c.toMillis()
    if (typeof c._seconds === 'number') return c._seconds * 1000
    if (typeof c.seconds === 'number') return c.seconds * 1000
  }
  return 0
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const requestedOrgId =
    searchParams.get('orgId') ?? (user.role === 'admin' || user.role === 'ai' ? PIB_PLATFORM_ORG_ID : null)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const snap = await adminDb.collection('rss_automations').where('orgId', '==', scope.orgId).get()
  const data = (snap.docs as FirestoreDoc[])
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => (d as { deleted?: boolean }).deleted !== true)
    .sort(
      (a, b) =>
        timestampMillis((b as { createdAt?: unknown }).createdAt) -
        timestampMillis((a as { createdAt?: unknown }).createdAt),
    )

  return apiSuccess(data, 200, { total: data.length })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const requestedOrgId =
    typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : user.role === 'admin' || user.role === 'ai'
        ? PIB_PLATFORM_ORG_ID
        : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const validation = validateRssAutomationInput(body, scope.orgId)
  if (!validation.ok || !validation.value) return apiError(validation.error ?? 'Invalid input', 400)

  const ref = await adminDb.collection('rss_automations').add({
    ...validation.value,
    lastRunAt: null,
    lastPostGuid: '',
    lastSentCount: 0,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: ref.id, ...validation.value }, 201)
})
