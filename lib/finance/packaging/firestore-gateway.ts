import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  PackagingFinanceService,
  clonePackagingStore,
  createEmptyPackagingStore,
  type ArchivePackCommand,
  type CreatePackagingPackCommand,
  type MarkDownloadedPackCommand,
  type PackagingFinanceStore,
} from './service'
import type { FinanceExportPack, PackagingFamily } from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(): Promise<PackagingFinanceStore> {
  const db = adminDb
  const [packs, claims] = await Promise.all([
    db.collection('finance_export_packs').limit(2000).get(),
    db.collection('finance_export_pack_claims').limit(10000).get(),
  ])
  const store = createEmptyPackagingStore()
  store.packs = asMap<FinanceExportPack>(packs)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(before: PackagingFinanceStore, after: PackagingFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops++
  }
  for (const [id, value] of after.packs) {
    touch('finance_export_packs', id, value, before.packs.get(id))
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_export_pack_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  if (ops > 0) await batch.commit()
}

export class FirestorePackagingFinanceGateway {
  private readonly service = new PackagingFinanceService(loadStore, saveStore)

  createPack(actor: FinanceActorContext, command: CreatePackagingPackCommand) {
    return this.service.createPack(actor, command)
  }

  markDownloaded(actor: FinanceActorContext, command: MarkDownloadedPackCommand) {
    return this.service.markDownloaded(actor, command)
  }

  archivePack(actor: FinanceActorContext, command: ArchivePackCommand) {
    return this.service.archivePack(actor, command)
  }

  listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    filters?: { bookId?: string; family?: PackagingFamily; packId?: string },
  ) {
    return this.service.listForOrg(actor, orgId, filters)
  }
}

export type {
  ArchivePackCommand,
  CreatePackagingPackCommand,
  MarkDownloadedPackCommand,
}
