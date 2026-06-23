// app/api/v1/admin/system/migrations/runs/[runId]/rollback/route.ts
// POST — super-admin only. Rolls back a migration run, when the migration
// definition declares rollback support. Neither seeded migration supports
// rollback, so this guards generically and never fabricates a rollback.

import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req, user, context) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  const { runId } = (await context.params) as { runId: string }

  const body = (await req.json().catch(() => ({}))) as { confirm?: string }
  if (body.confirm !== runId) {
    return apiError('Confirmation token must equal the run id', 400)
  }

  const runRef = adminDb.collection('migration_runs').doc(runId)
  const runSnap = await runRef.get()
  if (!runSnap.exists) return apiError('Run not found', 404)
  const run = runSnap.data() as { migrationId?: string; log?: string[] }

  const migrationId = run.migrationId
  if (!migrationId) return apiError('Run has no migrationId', 400)

  const defSnap = await adminDb.collection('migrations').doc(migrationId).get()
  if (!defSnap.exists) return apiError('Migration not found', 404)
  const def = defSnap.data() as { rollbackSupported?: boolean }

  if (!def.rollbackSupported) {
    return apiError('This migration does not support rollback', 400)
  }

  // rollbackSupported is true but there is no real rollback helper registered.
  // Record the attempt and refuse rather than fabricate a rollback.
  const log = Array.isArray(run.log) ? [...run.log] : []
  log.push(
    `[${new Date().toISOString()}] No rollback handler registered for this migration`,
  )
  await runRef.update({ log })

  return apiError('No rollback handler registered for this migration', 400)
})
