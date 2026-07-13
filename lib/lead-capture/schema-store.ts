import { FieldValue } from 'firebase-admin/firestore'
import type { CaptureField } from '@/lib/lead-capture/types'
import { LEAD_CAPTURE_SCHEMA_VERSIONS } from '@/lib/lead-capture/types'
import { buildCaptureSchemaVersion } from '@/lib/lead-capture/schema'

type Ref = Record<string, unknown>
type Snapshot = { exists: boolean; data: () => Record<string, unknown> | undefined }
type Transaction = {
  get: (ref: Ref) => Promise<Snapshot>
  create: (ref: Ref, data: Record<string, unknown>) => unknown
  update: (ref: Ref, data: Record<string, unknown>) => unknown
}
type Db = {
  collection: (name: string) => { doc: (id: string) => Ref }
  runTransaction: <T>(callback: (transaction: Transaction) => Promise<T>) => Promise<T>
}

function immutableContent(value: Record<string, unknown> | undefined) {
  return JSON.stringify({
    orgId: value?.orgId,
    captureSourceId: value?.captureSourceId,
    fields: value?.fields,
  })
}

export async function publishCaptureSchemaVersion(
  db: Db,
  sourceRef: Ref,
  input: { orgId: string; sourceId: string; fields: CaptureField[]; createdBy?: string; sourcePatch?: Record<string, unknown> },
) {
  const version = buildCaptureSchemaVersion(input)
  const versionRef = db.collection(LEAD_CAPTURE_SCHEMA_VERSIONS).doc(`${input.sourceId}_${version.id}`)
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(versionRef)
    const record = {
      ...version,
      createdAt: FieldValue.serverTimestamp(),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    }
    if (existing.exists) {
      if (immutableContent(existing.data()) !== immutableContent(record)) {
        throw new Error('immutable schema version collision')
      }
    } else {
      transaction.create(versionRef, record)
    }
    transaction.update(sourceRef, { ...(input.sourcePatch ?? {}), activeSchemaVersionId: version.id })
  })
  return version
}
