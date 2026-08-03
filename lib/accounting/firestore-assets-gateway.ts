import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  AssetsFinanceService,
  cloneAssetsStore,
  createEmptyAssetsStore,
  type ActivateFixedAssetCommand,
  type AssetsFinanceStore,
  type CalculateDepreciationRunCommand,
  type CreateAssetClassCommand,
  type CreateDepreciationRunCommand,
  type CreateFixedAssetCommand,
  type DepreciationJournalPoster,
  type DisposeFixedAssetCommand,
  type DisposalJournalPoster,
  type PostDepreciationRunCommand,
} from './assets-service'
import type { AssetClass, AssetDisposal, DepreciationRun, FixedAsset } from './assets-types'
import { createHash } from 'crypto'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(): Promise<AssetsFinanceStore> {
  const db = adminDb
  const [classes, assets, runs, disposals, claims, idem] = await Promise.all([
    db.collection('asset_classes').limit(5000).get(),
    db.collection('fixed_assets').limit(10000).get(),
    db.collection('depreciation_runs').limit(5000).get(),
    db.collection('asset_disposals').limit(5000).get(),
    db.collection('finance_assets_claims').limit(20000).get(),
    db.collection('finance_assets_idempotency').limit(20000).get(),
  ])
  const store = createEmptyAssetsStore()
  store.assetClasses = asMap<AssetClass>(classes)
  store.assets = asMap<FixedAsset>(assets)
  store.depreciationRuns = asMap<DepreciationRun>(runs)
  store.disposals = asMap<AssetDisposal>(disposals)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  for (const doc of idem.docs) {
    const data = doc.data() as { key?: string; operation?: string; resultId?: string }
    if (data.key && data.operation && data.resultId) {
      store.idempotency.set(data.key, { operation: data.operation, resultId: data.resultId })
    }
  }
  return store
}

async function saveStore(before: AssetsFinanceStore, after: AssetsFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops += 1
  }
  for (const [id, value] of after.assetClasses) touch('asset_classes', id, value, before.assetClasses.get(id))
  for (const [id, value] of after.assets) touch('fixed_assets', id, value, before.assets.get(id))
  for (const [id, value] of after.depreciationRuns) touch('depreciation_runs', id, value, before.depreciationRuns.get(id))
  for (const [id, value] of after.disposals) touch('asset_disposals', id, value, before.disposals.get(id))
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(db.collection('finance_assets_claims').doc(claimId), {
      id: claimId,
      key,
      createdAt: new Date().toISOString(),
    }, { merge: true })
    ops += 1
  }
  for (const [key, value] of after.idempotency) {
    if (before.idempotency.get(key)?.resultId === value.resultId) continue
    const id = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(db.collection('finance_assets_idempotency').doc(id), {
      id,
      key,
      operation: value.operation,
      resultId: value.resultId,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    ops += 1
  }
  if (ops > 0) await batch.commit()
}

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

const defaultDepreciationPoster: DepreciationJournalPoster = async (input) => {
  const { run, journalEntryId, actor } = input
  const now = new Date().toISOString()
  const byAccount = new Map<string, { debitMinor: number; creditMinor: number; description: string }>()
  for (const item of run.items) {
    if (item.amountMinor <= 0) continue
    const exp = byAccount.get(`dr:${item.expenseAccountId}`) || {
      debitMinor: 0,
      creditMinor: 0,
      description: 'Depreciation expense',
    }
    exp.debitMinor += item.amountMinor
    byAccount.set(`dr:${item.expenseAccountId}`, exp)
    const acc = byAccount.get(`cr:${item.accumulatedDepAccountId}`) || {
      debitMinor: 0,
      creditMinor: 0,
      description: 'Accumulated depreciation',
    }
    acc.creditMinor += item.amountMinor
    byAccount.set(`cr:${item.accumulatedDepAccountId}`, acc)
  }
  const lines = [...byAccount.entries()].map(([key, line], index) => ({
    id: `${journalEntryId}_${String(index + 1).padStart(4, '0')}`,
    accountId: key.slice(3),
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
    sequence: index + 1,
  }))
  const totalDebitMinor = lines.reduce((s, l) => s + l.debitMinor, 0)
  const totalCreditMinor = lines.reduce((s, l) => s + l.creditMinor, 0)
  const entry = {
    id: journalEntryId,
    orgId: run.orgId,
    legalEntityId: run.legalEntityId,
    bookId: run.bookId,
    periodId: run.periodId || run.periodKey,
    sourceType: 'fixed_asset_depreciation',
    sourceId: run.id,
    sourceVersion: run.version,
    postingPurpose: 'monthly_depreciation',
    entryNumber: 0,
    entryType: 'depreciation',
    postingDate: run.postingDate,
    documentDate: run.postingDate,
    status: 'posted' as const,
    description: run.description,
    currency: 'ZAR',
    policyVersionId: 'assets-depreciation',
    accountingBasis: 'accrual',
    totalDebitMinor,
    totalCreditMinor,
    lines,
    lineDigest: digest(lines),
    approvalId: run.approvalId || 'assets-depreciation',
    approvalActorId: actor.uid,
    approvedAt: now,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    immutable: true as const,
    contentHash: digest([journalEntryId, run.id, lines]),
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: 'sha256-v1',
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
    schemaVersion: 1 as const,
    version: 1,
    externalEgressAllowed: false,
  }
  await adminDb.collection('journal_entries').doc(journalEntryId).set(entry, { merge: true })
  return { id: journalEntryId }
}

const defaultDisposalPoster: DisposalJournalPoster = async (input) => {
  const { disposal, asset, journalEntryId, actor } = input
  const now = new Date().toISOString()
  const lines: Array<{ id: string; accountId: string; debitMinor: number; creditMinor: number; description: string; sequence: number }> = []
  let seq = 1
  // Clear cost and accumulated dep; recognize proceeds and gain/loss.
  if (asset.accumulatedDepreciationMinor > 0) {
    lines.push({
      id: `${journalEntryId}_${String(seq).padStart(4, '0')}`,
      accountId: asset.accumulatedDepAccountId,
      debitMinor: asset.accumulatedDepreciationMinor,
      creditMinor: 0,
      description: 'Clear accumulated depreciation',
      sequence: seq,
    })
    seq += 1
  }
  if (disposal.proceedsMinor > 0) {
    lines.push({
      id: `${journalEntryId}_${String(seq).padStart(4, '0')}`,
      accountId: disposal.proceedsAccountId,
      debitMinor: disposal.proceedsMinor,
      creditMinor: 0,
      description: 'Disposal proceeds (observed, not initiated)',
      sequence: seq,
    })
    seq += 1
  }
  if (disposal.gainLossMinor < 0) {
    lines.push({
      id: `${journalEntryId}_${String(seq).padStart(4, '0')}`,
      accountId: disposal.gainLossAccountId,
      debitMinor: Math.abs(disposal.gainLossMinor),
      creditMinor: 0,
      description: 'Loss on disposal',
      sequence: seq,
    })
    seq += 1
  }
  lines.push({
    id: `${journalEntryId}_${String(seq).padStart(4, '0')}`,
    accountId: asset.assetAccountId,
    debitMinor: 0,
    creditMinor: asset.costMinor,
    description: 'Remove asset cost',
    sequence: seq,
  })
  seq += 1
  if (disposal.gainLossMinor > 0) {
    lines.push({
      id: `${journalEntryId}_${String(seq).padStart(4, '0')}`,
      accountId: disposal.gainLossAccountId,
      debitMinor: 0,
      creditMinor: disposal.gainLossMinor,
      description: 'Gain on disposal',
      sequence: seq,
    })
  }
  const totalDebitMinor = lines.reduce((s, l) => s + l.debitMinor, 0)
  const totalCreditMinor = lines.reduce((s, l) => s + l.creditMinor, 0)
  const entry = {
    id: journalEntryId,
    orgId: disposal.orgId,
    legalEntityId: disposal.legalEntityId,
    bookId: disposal.bookId,
    periodId: disposal.disposedAt.slice(0, 7),
    sourceType: 'fixed_asset_disposal',
    sourceId: disposal.id,
    sourceVersion: disposal.version,
    postingPurpose: 'asset_disposal',
    entryNumber: 0,
    entryType: 'disposal',
    postingDate: disposal.disposedAt,
    documentDate: disposal.disposedAt,
    status: 'posted' as const,
    description: disposal.description || `Dispose ${asset.assetNumber}`,
    currency: asset.currency,
    policyVersionId: 'assets-disposal',
    accountingBasis: 'accrual',
    totalDebitMinor,
    totalCreditMinor,
    lines,
    lineDigest: digest(lines),
    approvalId: disposal.approvalId || 'assets-disposal',
    approvalActorId: actor.uid,
    approvedAt: now,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    immutable: true as const,
    contentHash: digest([journalEntryId, disposal.id, lines]),
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: 'sha256-v1',
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
    schemaVersion: 1 as const,
    version: 1,
    externalEgressAllowed: false,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
  }
  await adminDb.collection('journal_entries').doc(journalEntryId).set(entry, { merge: true })
  return { id: journalEntryId }
}

function service() {
  return new AssetsFinanceService(
    loadStore,
    saveStore,
    defaultDepreciationPoster,
    defaultDisposalPoster,
  )
}

export class FirestoreFinanceAssetsGateway {
  createAssetClass(actor: FinanceActorContext, command: CreateAssetClassCommand) {
    return service().createAssetClass(actor, command)
  }

  createFixedAsset(actor: FinanceActorContext, command: CreateFixedAssetCommand) {
    return service().createFixedAsset(actor, command)
  }

  activateFixedAsset(actor: FinanceActorContext, command: ActivateFixedAssetCommand) {
    return service().activateFixedAsset(actor, command)
  }

  createDepreciationRun(actor: FinanceActorContext, command: CreateDepreciationRunCommand) {
    return service().createDepreciationRun(actor, command)
  }

  calculateDepreciationRun(actor: FinanceActorContext, command: CalculateDepreciationRunCommand) {
    return service().calculateDepreciationRun(actor, command)
  }

  postDepreciationRun(actor: FinanceActorContext, command: PostDepreciationRunCommand) {
    return service().postDepreciationRun(actor, command)
  }

  disposeFixedAsset(actor: FinanceActorContext, command: DisposeFixedAssetCommand) {
    return service().disposeFixedAsset(actor, command)
  }

  listBundle(actor: FinanceActorContext, scope: { orgId: string; legalEntityId: string; bookId: string }) {
    return service().getBundle(actor, scope)
  }

  registerReport(actor: FinanceActorContext, scope: { orgId: string; legalEntityId: string; bookId: string }, asOfDate: string) {
    return service().buildRegisterReport(actor, scope, asOfDate)
  }

  depreciationRunReport(actor: FinanceActorContext, scope: { orgId: string; legalEntityId: string; bookId: string }, runId: string) {
    return service().buildDepreciationRunReport(actor, scope, runId)
  }
}
