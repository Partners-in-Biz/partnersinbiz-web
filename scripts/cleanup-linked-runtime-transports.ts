import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

const LEGACY_TRANSPORT_COLLECTION = 'linked_device_runtime_transports'
const MIGRATION_RUNS = 'linked_computer_migration_runs'
const AUDIT = 'linked_computer_audit_events'
const SCANNED_COLLECTIONS = ['linked_devices', 'linked_device_credentials', 'linked_device_rotation_deliveries'] as const
const LEGACY_FIELDS = ['runtimeEndpoint', 'endpoint', 'bootstrapTransport', 'transportToken', 'encryptedTransportToken', 'encryptedOutboundToken'] as const

type LegacyField = typeof LEGACY_FIELDS[number]
type CleanupRow = { collection: string; id: string; data: Record<string, unknown> }
export type CleanupAction = { collection: string; id: string; kind: 'delete-document' | 'delete-fields'; fields: LegacyField[] }

export function planLinkedRuntimeTransportCleanup(rows: CleanupRow[]): CleanupAction[] {
  const actions: CleanupAction[] = []
  for (const row of rows) {
    if (row.collection === LEGACY_TRANSPORT_COLLECTION) {
      actions.push({ collection: row.collection, id: row.id, kind: 'delete-document', fields: [] })
      continue
    }
    if (!SCANNED_COLLECTIONS.includes(row.collection as typeof SCANNED_COLLECTIONS[number])) continue
    const fields = LEGACY_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(row.data, field))
    if (fields.length) actions.push({ collection: row.collection, id: row.id, kind: 'delete-fields', fields })
  }
  return actions
}

type CleanupDb = typeof adminDb

async function readRows(db: CleanupDb, deviceId?: string): Promise<CleanupRow[]> {
  const collections = [LEGACY_TRANSPORT_COLLECTION, ...SCANNED_COLLECTIONS]
  const groups = await Promise.all(collections.map(async (collection) => {
    if (deviceId) {
      const snap = await db.collection(collection).doc(deviceId).get()
      return snap.exists ? [{ collection, id: snap.id, data: snap.data() ?? {} }] : []
    }
    const snap = await db.collection(collection).get()
    return snap.docs.map((doc) => ({ collection, id: doc.id, data: doc.data() }))
  }))
  return groups.flat()
}

export async function cleanupLinkedRuntimeTransports(options: {
  apply?: boolean; deviceId?: string; runId?: string; db?: CleanupDb; batchSize?: number
} = {}) {
  const db = options.db ?? adminDb
  const actions = planLinkedRuntimeTransportCleanup(await readRows(db, options.deviceId))
  const counts = {
    mode: options.apply ? 'apply' as const : 'dry-run' as const,
    scope: options.deviceId ? 'device' as const : 'all-linked-devices' as const,
    transportDocuments: actions.filter((action) => action.kind === 'delete-document').length,
    documentsWithLegacyFields: actions.filter((action) => action.kind === 'delete-fields').length,
    legacyFields: actions.reduce((count, action) => count + action.fields.length, 0),
  }
  if (!options.apply) return counts

  const runId = options.runId ?? randomUUID()
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(runId)) throw new Error('Invalid migration run ID')
  const runRef = db.collection(MIGRATION_RUNS).doc(runId)
  const existingSnap = await runRef.get()
  const existing = existingSnap.data() ?? {}
  if (existingSnap.exists) {
    if (existing.migration !== 'linked-runtime-transport-cleanup' || existing.scope !== counts.scope
      || (existing.deviceId ?? null) !== (options.deviceId ?? null)) throw new Error('Migration run scope mismatch')
    if (existing.status === 'complete') return { mode: counts.mode, scope: counts.scope, ...(existing.completed as Record<string, number>), runId, status: 'complete' as const }
    await runRef.set({ status: 'running', resumedAt: FieldValue.serverTimestamp(), lastError: null }, { merge: true })
  } else {
    await runRef.create({
      runId, migration: 'linked-runtime-transport-cleanup', mode: 'apply', scope: counts.scope,
      deviceId: options.deviceId ?? null, status: 'running', planned: counts,
      completed: { transportDocuments: 0, documentsWithLegacyFields: 0, legacyFields: 0 },
      batchIndex: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  }

  const completed = {
    transportDocuments: Number((existing.completed as Record<string, unknown> | undefined)?.transportDocuments ?? 0),
    documentsWithLegacyFields: Number((existing.completed as Record<string, unknown> | undefined)?.documentsWithLegacyFields ?? 0),
    legacyFields: Number((existing.completed as Record<string, unknown> | undefined)?.legacyFields ?? 0),
  }
  let batchIndex = Number(existing.batchIndex ?? 0)
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 398, 398))
  try {
    for (let offset = 0; offset < actions.length; offset += batchSize) {
      const slice = actions.slice(offset, offset + batchSize)
      const batch = db.batch()
      for (const action of slice) {
        const ref = db.collection(action.collection).doc(action.id)
        if (action.kind === 'delete-document') batch.delete(ref)
        else batch.update(ref, Object.fromEntries(action.fields.map((field) => [field, FieldValue.delete()])))
      }
      const nextCompleted = {
        transportDocuments: completed.transportDocuments + slice.filter((action) => action.kind === 'delete-document').length,
        documentsWithLegacyFields: completed.documentsWithLegacyFields + slice.filter((action) => action.kind === 'delete-fields').length,
        legacyFields: completed.legacyFields + slice.reduce((count, action) => count + action.fields.length, 0),
      }
      const nextBatchIndex = batchIndex + 1
      batch.create(db.collection(AUDIT).doc(`${runId}_${nextBatchIndex}`), {
        action: 'legacy_transport.cleanup_batch', actorUserId: 'system:migration', runId,
        scope: counts.scope, deviceId: options.deviceId ?? null, batchIndex: nextBatchIndex, completed: nextCompleted,
        createdAt: FieldValue.serverTimestamp(),
      })
      batch.set(runRef, {
        status: 'running', batchIndex: nextBatchIndex, completed: nextCompleted,
        checkpoint: { batchIndex: nextBatchIndex, remainingActions: Math.max(0, actions.length - offset - slice.length) },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      await batch.commit()
      Object.assign(completed, nextCompleted)
      batchIndex = nextBatchIndex
    }
    await runRef.set({ status: 'complete', batchIndex, completed, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  } catch (error) {
    await runRef.set({
      status: 'failed', batchIndex, completed, lastError: 'A cleanup batch failed; inspect server logs and resume with the same run ID.',
      failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    throw error
  }
  return { mode: counts.mode, scope: counts.scope, ...completed, runId, status: 'complete' as const }
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply')
  const deviceArg = argv.find((arg) => arg.startsWith('--device-id='))
  const deviceId = deviceArg?.slice('--device-id='.length).trim()
  const runArg = argv.find((arg) => arg.startsWith('--run-id='))
  const runId = runArg?.slice('--run-id='.length).trim()
  if (deviceId && !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) throw new Error('Invalid --device-id')
  if (runId && !/^[A-Za-z0-9_-]{8,128}$/.test(runId)) throw new Error('Invalid --run-id')
  return { apply, ...(deviceId ? { deviceId } : {}), ...(runId ? { runId } : {}) }
}

if (require.main === module) {
  cleanupLinkedRuntimeTransports(parseArgs(process.argv.slice(2)))
    .then((counts) => console.log(JSON.stringify(counts)))
    .catch((error) => { console.error(error instanceof Error ? error.message : 'Cleanup failed'); process.exitCode = 1 })
}
