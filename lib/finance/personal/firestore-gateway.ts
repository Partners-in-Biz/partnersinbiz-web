import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  PersonalFinanceService,
  clonePersonalStore,
  createEmptyPersonalStore,
  type CreatePersonalAccountCommand,
  type CreatePersonalBookCommand,
  type PersonalFinanceStore,
  type PostPersonalEntryCommand,
  type ProposePersonalTransferCommand,
  type RejectPersonalTransferCommand,
  type ResolvePersonalTransferCommand,
} from './service'
import type {
  PersonalAccount,
  PersonalBook,
  PersonalEntry,
  PersonalTransferObservation,
} from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(orgId: string, ownerUid?: string): Promise<PersonalFinanceStore> {
  const db = adminDb
  const booksQ = ownerUid
    ? db.collection('personal_books').where('orgId', '==', orgId).where('ownerUid', '==', ownerUid)
    : db.collection('personal_books').where('orgId', '==', orgId)
  const accountsQ = ownerUid
    ? db.collection('personal_accounts').where('orgId', '==', orgId).where('ownerUid', '==', ownerUid)
    : db.collection('personal_accounts').where('orgId', '==', orgId)
  const entriesQ = ownerUid
    ? db.collection('personal_entries').where('orgId', '==', orgId).where('ownerUid', '==', ownerUid)
    : db.collection('personal_entries').where('orgId', '==', orgId)
  // transfers can be proposed for any member — load by org then filter in service for owner bundle
  const transfersQ = ownerUid
    ? db.collection('personal_transfer_observations').where('orgId', '==', orgId).where('memberUid', '==', ownerUid)
    : db.collection('personal_transfer_observations').where('orgId', '==', orgId)
  const claimsQ = db.collection('personal_finance_claims').where('orgId', '==', orgId)

  const [books, accounts, entries, transfers, claims] = await Promise.all([
    booksQ.get(),
    accountsQ.get(),
    entriesQ.get(),
    transfersQ.get(),
    claimsQ.get(),
  ])

  const store = createEmptyPersonalStore()
  store.books = asMap<PersonalBook>(books)
  store.accounts = asMap<PersonalAccount>(accounts)
  store.entries = asMap<PersonalEntry>(entries)
  store.transfers = asMap<PersonalTransferObservation>(transfers)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(
  orgId: string,
  before: PersonalFinanceStore,
  after: PersonalFinanceStore,
): Promise<void> {
  const db = adminDb
  const batch = db.batch()

  const writeMap = <T extends { id: string }>(
    collection: string,
    prev: Map<string, T>,
    next: Map<string, T>,
  ) => {
    for (const [id, value] of next) {
      const prior = prev.get(id)
      if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
      batch.set(db.collection(collection).doc(id), value, { merge: true })
    }
  }

  writeMap('personal_books', before.books, after.books)
  writeMap('personal_accounts', before.accounts, after.accounts)
  writeMap('personal_entries', before.entries, after.entries)
  writeMap('personal_transfer_observations', before.transfers, after.transfers)

  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('personal_finance_claims').doc(claimId),
      { id: claimId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }

  await batch.commit()
}

export class FirestorePersonalFinanceGateway {
  private serviceFor(orgId: string, ownerUid?: string) {
    return new PersonalFinanceService(
      () => loadStore(orgId, ownerUid),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  /** Load org-wide store for transfer propose (admin) — still never returns other members' books via public query. */
  private serviceOrg(orgId: string) {
    return new PersonalFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  createBook(actor: FinanceActorContext, command: CreatePersonalBookCommand) {
    return this.serviceFor(command.orgId, actor.uid).createBook(actor, command)
  }

  createAccount(actor: FinanceActorContext, command: CreatePersonalAccountCommand) {
    return this.serviceFor(command.orgId, actor.uid).createAccount(actor, command)
  }

  postEntry(actor: FinanceActorContext, command: PostPersonalEntryCommand) {
    return this.serviceFor(command.orgId, actor.uid).postEntry(actor, command)
  }

  proposeTransfer(actor: FinanceActorContext, command: ProposePersonalTransferCommand) {
    return this.serviceOrg(command.orgId).proposeTransfer(actor, command)
  }

  acceptTransfer(actor: FinanceActorContext, command: ResolvePersonalTransferCommand) {
    return this.serviceFor(command.orgId, actor.uid).acceptTransfer(actor, command)
  }

  rejectTransfer(actor: FinanceActorContext, command: RejectPersonalTransferCommand) {
    return this.serviceFor(command.orgId, actor.uid).rejectTransfer(actor, command)
  }

  getOwnerBundle(actor: FinanceActorContext, orgId: string) {
    return this.serviceFor(orgId, actor.uid).getOwnerBundle(actor, orgId)
  }
}

export type {
  CreatePersonalAccountCommand,
  CreatePersonalBookCommand,
  PostPersonalEntryCommand,
  ProposePersonalTransferCommand,
  RejectPersonalTransferCommand,
  ResolvePersonalTransferCommand,
}

export { clonePersonalStore, createEmptyPersonalStore, PersonalFinanceService }
