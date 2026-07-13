import { FieldValue } from 'firebase-admin/firestore'
import type { CaptureField, WidgetDisplayConfig } from '@/lib/lead-capture/types'
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
    display: value?.display,
  })
}

export async function publishCaptureSchemaVersion(
  db: Db,
  sourceRef: Ref,
  input: { orgId: string; sourceId: string; fields: CaptureField[]; display?: WidgetDisplayConfig; createdBy?: string; sourcePatch?: Record<string, unknown> },
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

export async function loadCaptureSchemaVersion(
  db: Pick<Db, 'collection'>,
  sourceId: string,
  versionId: string,
) {
  if (!/^schema_[a-f0-9]{24}$/.test(versionId)) throw new Error('Invalid capture schema version id')
  const ref = db.collection(LEAD_CAPTURE_SCHEMA_VERSIONS).doc(`${sourceId}_${versionId}`) as Ref & { get?: () => Promise<Snapshot> }
  if (!ref.get) throw new Error('Capture schema version store is unavailable')
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Capture schema version not found')
  const record = snap.data()
  if (!record || record.captureSourceId !== sourceId) throw new Error('Capture schema version does not belong to this source')
  const expected = buildCaptureSchemaVersion({
    orgId: String(record.orgId ?? ''),
    sourceId,
    fields: record.fields as CaptureField[],
    display: record.display as WidgetDisplayConfig | undefined,
  })
  if (expected.id !== versionId) throw new Error('Capture schema version failed integrity verification')
  return record as unknown as ReturnType<typeof buildCaptureSchemaVersion>
}
