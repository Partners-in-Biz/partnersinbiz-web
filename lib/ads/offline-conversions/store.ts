// lib/ads/offline-conversions/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { OfflineConversionBatch, OfflineConversionRow, BatchStatus } from './types'
import crypto from 'crypto'

const BATCHES = 'ad_offline_conversion_batches'

export async function createBatch(args: {
  orgId: string
  conversionActionId: string
  csvPath: string
  totalRows: number
  createdBy: string
}): Promise<OfflineConversionBatch> {
  const id = `ocb_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()
  const doc: OfflineConversionBatch = {
    id,
    orgId: args.orgId,
    conversionActionId: args.conversionActionId,
    csvPath: args.csvPath,
    status: 'queued',
    totalRows: args.totalRows,
    processedRows: 0,
    failedRows: 0,
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
  }
  await adminDb.collection(BATCHES).doc(id).set(doc)
  return doc
}

export async function getBatch(id: string): Promise<OfflineConversionBatch | null> {
  const snap = await adminDb.collection(BATCHES).doc(id).get()
  return snap.exists ? (snap.data() as OfflineConversionBatch) : null
}

export async function listBatches(args: {
  orgId: string
  status?: BatchStatus
}): Promise<OfflineConversionBatch[]> {
  let q = adminDb.collection(BATCHES).where('orgId', '==', args.orgId) as FirebaseFirestore.Query
  if (args.status) q = q.where('status', '==', args.status)
  const snap = await q.get()
  return snap.docs
    .map((d) => d.data() as OfflineConversionBatch)
    .sort((a, b) => (b.createdAt as Timestamp).seconds - (a.createdAt as Timestamp).seconds)
}

export async function updateBatchStatus(args: {
  batchId: string
  status: BatchStatus
  processedDelta?: number
  failedDelta?: number
  errorMessage?: string
}): Promise<void> {
  const patch: Record<string, unknown> = {
    status: args.status,
    updatedAt: Timestamp.now(),
  }
  if (args.processedDelta !== undefined) patch.processedRows = FieldValue.increment(args.processedDelta)
  if (args.failedDelta !== undefined) patch.failedRows = FieldValue.increment(args.failedDelta)
  if (args.errorMessage) patch.errorMessage = args.errorMessage
  if (args.status === 'completed' || args.status === 'partial') patch.completedAt = Timestamp.now()
  await adminDb.collection(BATCHES).doc(args.batchId).update(patch)
}

export async function upsertRow(args: {
  batchId: string
  row: Omit<OfflineConversionRow, 'id' | 'batchId'>
}): Promise<void> {
  const id = args.row.eventId
  await adminDb
    .collection(BATCHES)
    .doc(args.batchId)
    .collection('rows')
    .doc(id)
    .set(
      {
        ...args.row,
        id,
        batchId: args.batchId,
      },
      { merge: true },
    )
}

export async function listRows(args: {
  batchId: string
  status?: OfflineConversionRow['status']
}): Promise<OfflineConversionRow[]> {
  let q = adminDb
    .collection(BATCHES)
    .doc(args.batchId)
    .collection('rows') as FirebaseFirestore.Query
  if (args.status) q = q.where('status', '==', args.status)
  const snap = await q.get()
  return snap.docs.map((d) => d.data() as OfflineConversionRow)
}
