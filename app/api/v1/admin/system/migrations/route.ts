// app/api/v1/admin/system/migrations/route.ts
// GET — list registered migrations with their latest run summary.
// Seeds the two real migrations on first call when the collection is empty.

import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// Recursively serialise Firestore Timestamps (and Dates) to ISO strings.
function serialise(value: unknown): unknown {
  if (value == null) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown> & { toMillis?: () => number; toDate?: () => Date }
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

// The only two real migrations. Doc id === stable slug.
const SEED_MIGRATIONS = [
  {
    id: 'migrate-companies-from-contacts',
    name: 'Migrate companies from contacts',
    description:
      "Group contacts' free-text company strings into first-class Company entities and link contacts.",
    status: 'idle',
    lastRunAt: null,
    dryRunSupported: true,
    rollbackSupported: false,
    requiresOrgId: true,
  },
  {
    id: 'migrate-org-to-default-pipeline',
    name: 'Migrate deals to default pipeline',
    description:
      'Move legacy deals with a string `stage` onto a structured default Pipeline with stageId.',
    status: 'idle',
    lastRunAt: null,
    dryRunSupported: true,
    rollbackSupported: false,
    requiresOrgId: true,
  },
] as const

export const GET = withAuth('admin', async () => {
  const col = adminDb.collection('migrations')

  // Seed on empty.
  const existing = await col.limit(1).get()
  if (existing.empty) {
    for (const def of SEED_MIGRATIONS) {
      await col.doc(def.id).set(def, { merge: true })
    }
  }

  const snap = await col.get()
  const defs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))

  // For each migration, find its latest run. To avoid a composite index we
  // query by migrationId only (limit 20) and pick the max startedAt in memory.
  const migrations = await Promise.all(
    defs.map(async (def) => {
      const runsSnap = await adminDb
        .collection('migration_runs')
        .where('migrationId', '==', def.id)
        .limit(20)
        .get()

      let lastRun: Record<string, unknown> | null = null
      let bestMillis = -1
      for (const rd of runsSnap.docs) {
        const data = rd.data() as Record<string, unknown>
        const started = data.startedAt as { toMillis?: () => number } | undefined
        const millis = typeof started?.toMillis === 'function' ? started.toMillis() : 0
        if (millis > bestMillis) {
          bestMillis = millis
          lastRun = { id: rd.id, ...(serialise(data) as Record<string, unknown>) }
        }
      }

      return { ...(serialise(def) as Record<string, unknown>), lastRun }
    }),
  )

  return apiSuccess({ migrations })
})
