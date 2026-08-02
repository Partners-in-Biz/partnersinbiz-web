import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import type { AccountingBook } from '@/lib/accounting/types'
import type { OpenItem } from '@/lib/accounting/documents-types'
import {
  CutoverFinanceService,
  cloneCutoverStore,
  createEmptyCutoverStore,
  type ActivateCutoverPackageCommand,
  type ApproveCutoverPackageCommand,
  type BookCutoverApplier,
  type CreateCutoverPackageCommand,
  type CutoverFinanceStore,
  type OpeningJournalPoster,
  type OpeningOpenItemMaterializer,
  type UpdateCutoverPackageCommand,
  type ValidateCutoverPackageCommand,
} from './service'
import type { CutoverPackage } from './types'
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

async function loadStore(): Promise<CutoverFinanceStore> {
  const db = adminDb
  const [packages, claims, bookClaims] = await Promise.all([
    db.collection('finance_cutover_packages').limit(2000).get(),
    db.collection('finance_cutover_claims').limit(10000).get(),
    db.collection('finance_cutover_book_claims').limit(5000).get(),
  ])
  const store = createEmptyCutoverStore()
  store.packages = asMap<CutoverPackage>(packages)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  for (const doc of bookClaims.docs) {
    const data = doc.data() as { bookKey?: string; packageId?: string }
    const bookKey = data.bookKey || doc.id
    if (data.packageId) store.bookCutoverClaims.set(bookKey, data.packageId)
  }
  return store
}

async function saveStore(before: CutoverFinanceStore, after: CutoverFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops++
  }
  for (const [id, value] of after.packages) {
    touch('finance_cutover_packages', id, value, before.packages.get(id))
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_cutover_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  for (const [bookKey, packageId] of after.bookCutoverClaims) {
    if (before.bookCutoverClaims.get(bookKey) === packageId) continue
    const claimId = Buffer.from(bookKey).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_cutover_book_claims').doc(claimId),
      { id: claimId, bookKey, packageId, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  if (ops > 0) await batch.commit()
}

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

const defaultPoster: OpeningJournalPoster = async (input) => {
  const db = adminDb
  const { pkg, journalEntryId, actor } = input
  const now = new Date().toISOString()
  const lines = pkg.trialBalanceLines.map((line, index) => ({
    id: `${journalEntryId}_${String(index + 1).padStart(4, '0')}`,
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.accountName || line.accountCode || 'Opening balance',
    sequence: index + 1,
  }))
  const totalDebitMinor = lines.reduce((s, l) => s + l.debitMinor, 0)
  const totalCreditMinor = lines.reduce((s, l) => s + l.creditMinor, 0)
  const contentHash = digest([
    journalEntryId,
    pkg.id,
    pkg.orgId,
    pkg.bookId,
    pkg.cutoverAt,
    lines,
  ])
  const entry = {
    id: journalEntryId,
    orgId: pkg.orgId,
    legalEntityId: pkg.legalEntityId,
    bookId: pkg.bookId,
    periodId: pkg.periodId,
    sourceType: 'opening_balance',
    sourceId: pkg.id,
    sourceVersion: pkg.version,
    postingPurpose: 'opening_balance',
    entryType: 'opening',
    postingDate: pkg.cutoverAt,
    documentDate: pkg.cutoverAt,
    status: 'posted',
    description: `Opening trial balance cutover ${pkg.id}`,
    currency: pkg.currency,
    totalDebitMinor,
    totalCreditMinor,
    lines,
    approvalId: pkg.approvalId,
    approvalActorId: pkg.approvalActorId || actor.uid,
    approvedAt: pkg.approvedAt || now,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    immutable: true,
    contentHash,
    schemaVersion: 1,
    version: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
    cutoverPackageId: pkg.id,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }
  const ref = db.collection('finance_cutover_opening_journals').doc(journalEntryId)
  await ref.set(entry, { merge: true })
  return { id: journalEntryId }
}

const defaultMaterializer: OpeningOpenItemMaterializer = async (input) => {
  const db = adminDb
  const { pkg, actor } = input
  const now = new Date().toISOString()
  const openItemIds: string[] = []
  const batch = db.batch()
  let ops = 0
  for (const item of pkg.openingOpenItems) {
    const openItemId = item.id
    openItemIds.push(openItemId)
    const openItem: OpenItem & {
      cutoverPackageId: string
      legacySourceRef: string
      description?: string
    } = {
      id: openItemId,
      orgId: pkg.orgId,
      legalEntityId: pkg.legalEntityId,
      bookId: pkg.bookId,
      sourceType: 'opening',
      sourceId: item.legacySourceRef,
      sourceVersion: 1,
      counterpartyCompanyId: item.counterpartyCompanyId,
      counterpartyRole: item.counterpartyRole,
      currency: item.currency,
      originalMinor: item.originalMinor,
      outstandingMinor: item.originalMinor,
      dueDate: item.dueDate,
      taxDate: item.taxDate,
      controlAccountId: item.controlAccountId,
      status: 'open',
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
      cutoverPackageId: pkg.id,
      legacySourceRef: item.legacySourceRef,
      ...(item.description ? { description: item.description } : {}),
    }
    batch.set(db.collection('open_items').doc(openItemId), openItem, { merge: true })
    ops++
    if (ops >= 400) {
      await batch.commit()
      ops = 0
    }
  }
  // Payroll YTD + tax snapshots stored as cutover side-car evidence (not SARS/pay).
  for (const row of pkg.payrollYtdOpenings) {
    batch.set(
      db.collection('finance_cutover_payroll_ytd').doc(row.id),
      {
        ...row,
        orgId: pkg.orgId,
        legalEntityId: pkg.legalEntityId,
        bookId: pkg.bookId,
        cutoverPackageId: pkg.id,
        createdAt: now,
        createdBy: actor.uid,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      },
      { merge: true },
    )
    ops++
  }
  for (const row of pkg.taxStateSnapshots) {
    batch.set(
      db.collection('finance_cutover_tax_state').doc(row.id),
      {
        ...row,
        orgId: pkg.orgId,
        legalEntityId: pkg.legalEntityId,
        bookId: pkg.bookId,
        cutoverPackageId: pkg.id,
        createdAt: now,
        createdBy: actor.uid,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      },
      { merge: true },
    )
    ops++
  }
  if (ops > 0) await batch.commit()
  return { openItemIds }
}

const defaultBookApplier: BookCutoverApplier = async (input) => {
  const db = adminDb
  const { pkg, actor } = input
  const now = new Date().toISOString()
  // Books are stored under accounting_books with document id = book id (foundation repository).
  const snap = await db.collection('accounting_books').doc(pkg.bookId).get()
  if (!snap.exists) {
    // Soft path for bootstrap environments where book docs are not yet present:
    // still record the cutover intent on a dedicated collection.
    await db.collection('finance_cutover_book_activations').doc(`${pkg.orgId}_${pkg.bookId}`).set(
      {
        id: `${pkg.orgId}_${pkg.bookId}`,
        orgId: pkg.orgId,
        legalEntityId: pkg.legalEntityId,
        bookId: pkg.bookId,
        cutoverAt: pkg.cutoverAt,
        packageId: pkg.id,
        status: 'active',
        appliedAt: now,
        appliedBy: actor.uid,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      },
      { merge: true },
    )
    return { bookId: pkg.bookId, cutoverAt: pkg.cutoverAt, status: 'active' }
  }
  const book = snap.data() as AccountingBook
  if (book.orgId && book.orgId !== pkg.orgId) {
    throw new Error('Book organization does not match cutover package')
  }
  if (book.legalEntityId && book.legalEntityId !== pkg.legalEntityId) {
    throw new Error('Book legal entity does not match cutover package')
  }
  const next: Partial<AccountingBook> & { cutoverPackageId: string; cutoverActivatedAt: string } = {
    cutoverAt: pkg.cutoverAt,
    status: book.status === 'draft' ? 'active' : book.status,
    updatedAt: now,
    updatedBy: actor.uid,
    version: (book.version || 1) + 1,
    cutoverPackageId: pkg.id,
    cutoverActivatedAt: now,
  }
  await snap.ref.set(next, { merge: true })
  await db.collection('finance_cutover_book_activations').doc(`${pkg.orgId}_${pkg.bookId}`).set(
    {
      id: `${pkg.orgId}_${pkg.bookId}`,
      orgId: pkg.orgId,
      legalEntityId: pkg.legalEntityId,
      bookId: pkg.bookId,
      cutoverAt: pkg.cutoverAt,
      packageId: pkg.id,
      status: next.status,
      appliedAt: now,
      appliedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    },
    { merge: true },
  )
  return {
    bookId: pkg.bookId,
    cutoverAt: pkg.cutoverAt,
    status: (next.status || 'active') as 'active' | 'draft' | 'locked' | 'archived',
  }
}

export class FirestoreCutoverFinanceGateway {
  constructor(
    private readonly poster: OpeningJournalPoster = defaultPoster,
    private readonly materializer: OpeningOpenItemMaterializer = defaultMaterializer,
    private readonly bookApplier: BookCutoverApplier = defaultBookApplier,
  ) {}

  private service() {
    return new CutoverFinanceService(
      () => loadStore(),
      (before, after) => saveStore(before, after),
      this.poster,
      this.materializer,
      this.bookApplier,
    )
  }

  createPackage(actor: FinanceActorContext, command: CreateCutoverPackageCommand) {
    return this.service().createPackage(actor, command)
  }

  updatePackage(actor: FinanceActorContext, command: UpdateCutoverPackageCommand) {
    return this.service().updatePackage(actor, command)
  }

  validatePackage(actor: FinanceActorContext, command: ValidateCutoverPackageCommand) {
    return this.service().validatePackage(actor, command)
  }

  approvePackage(actor: FinanceActorContext, command: ApproveCutoverPackageCommand) {
    return this.service().approvePackage(actor, command)
  }

  activatePackage(actor: FinanceActorContext, command: ActivateCutoverPackageCommand) {
    return this.service().activatePackage(actor, command)
  }

  listForOrg(actor: FinanceActorContext, orgId: string, opts?: { bookId?: string; packageId?: string }) {
    return this.service().listForOrg(actor, orgId, opts)
  }
}

export type {
  ActivateCutoverPackageCommand,
  ApproveCutoverPackageCommand,
  CreateCutoverPackageCommand,
  UpdateCutoverPackageCommand,
  ValidateCutoverPackageCommand,
  CutoverFinanceStore,
  OpeningJournalPoster,
  OpeningOpenItemMaterializer,
  BookCutoverApplier,
}

export { CutoverFinanceService, cloneCutoverStore, createEmptyCutoverStore }
