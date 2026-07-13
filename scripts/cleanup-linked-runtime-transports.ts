import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

const LEGACY_TRANSPORT_COLLECTION = 'linked_device_runtime_transports'
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

async function readRows(deviceId?: string): Promise<CleanupRow[]> {
  const collections = [LEGACY_TRANSPORT_COLLECTION, ...SCANNED_COLLECTIONS]
  const groups = await Promise.all(collections.map(async (collection) => {
    if (deviceId) {
      const snap = await adminDb.collection(collection).doc(deviceId).get()
      return snap.exists ? [{ collection, id: snap.id, data: snap.data() ?? {} }] : []
    }
    const snap = await adminDb.collection(collection).get()
    return snap.docs.map((doc) => ({ collection, id: doc.id, data: doc.data() }))
  }))
  return groups.flat()
}

export async function cleanupLinkedRuntimeTransports(options: { apply?: boolean; deviceId?: string } = {}) {
  const actions = planLinkedRuntimeTransportCleanup(await readRows(options.deviceId))
  const counts = {
    mode: options.apply ? 'apply' as const : 'dry-run' as const,
    scope: options.deviceId ? 'device' as const : 'all-linked-devices' as const,
    transportDocuments: actions.filter((action) => action.kind === 'delete-document').length,
    documentsWithLegacyFields: actions.filter((action) => action.kind === 'delete-fields').length,
    legacyFields: actions.reduce((count, action) => count + action.fields.length, 0),
  }
  if (!options.apply || actions.length === 0) return counts

  for (let offset = 0; offset < actions.length; offset += 400) {
    const batch = adminDb.batch()
    for (const action of actions.slice(offset, offset + 400)) {
      const ref = adminDb.collection(action.collection).doc(action.id)
      if (action.kind === 'delete-document') batch.delete(ref)
      else batch.update(ref, Object.fromEntries(action.fields.map((field) => [field, FieldValue.delete()])))
    }
    await batch.commit()
  }
  await adminDb.collection('linked_computer_audit_events').doc(randomUUID()).create({
    action: 'legacy_transport.cleaned', actorUserId: 'system:migration', deviceId: options.deviceId ?? null,
    scope: counts.scope, transportDocuments: counts.transportDocuments,
    documentsWithLegacyFields: counts.documentsWithLegacyFields, legacyFields: counts.legacyFields,
    createdAt: FieldValue.serverTimestamp(),
  })
  return counts
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply')
  const deviceArg = argv.find((arg) => arg.startsWith('--device-id='))
  const deviceId = deviceArg?.slice('--device-id='.length).trim()
  if (deviceId && !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) throw new Error('Invalid --device-id')
  return { apply, ...(deviceId ? { deviceId } : {}) }
}

if (require.main === module) {
  cleanupLinkedRuntimeTransports(parseArgs(process.argv.slice(2)))
    .then((counts) => console.log(JSON.stringify(counts)))
    .catch((error) => { console.error(error instanceof Error ? error.message : 'Cleanup failed'); process.exitCode = 1 })
}
