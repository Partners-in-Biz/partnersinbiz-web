// app/api/v1/admin/system/migrations/runs/[runId]/route.ts
// GET — fetch a single migration run for live polling.

import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

function serialise(value: unknown): unknown {
  if (value == null) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const obj = value as { toMillis?: () => number; toDate?: () => Date }
    if (typeof obj.toDate === 'function' && typeof obj.toMillis === 'function') {
      try {
        return obj.toDate().toISOString()
      } catch {
        return null
      }
    }
    if (Array.isArray(value)) return value.map(serialise)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialise(v)
    return out
  }
  return value
}

export const GET = withAuth('admin', async (_req, _user, context) => {
  const { runId } = (await context.params) as { runId: string }
  const snap = await adminDb.collection('migration_runs').doc(runId).get()
  if (!snap.exists) return apiError('Run not found', 404)
  const run = { id: snap.id, ...(serialise(snap.data()) as Record<string, unknown>) }
  return apiSuccess({ run })
})
