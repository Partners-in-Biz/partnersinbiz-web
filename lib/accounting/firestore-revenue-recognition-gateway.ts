import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import {
  cloneRevenueRecognitionStore,
  createEmptyRevenueRecognitionStore,
  RevenueRecognitionService,
  type ActivateRevenueScheduleCommand,
  type CalculateRecognitionRunCommand,
  type CancelRevenueScheduleCommand,
  type CreateRecognitionRunCommand,
  type CreateRevenueScheduleCommand,
  type PostRecognitionRunCommand,
  type RecognitionJournalPoster,
  type ReverseRecognitionRunCommand,
  type RevenueRecognitionStore,
} from './revenue-recognition-service'
import type {
  RecognitionRun,
  RevenueRecognitionAuditEvent,
  RevenueSchedule,
} from './revenue-recognition-types'
import { buildRecognitionJournalLines, buildReversalJournalLines } from './revenue-recognition'
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

async function loadStore(): Promise<RevenueRecognitionStore> {
  const db = adminDb
  const [schedules, runs, audits, claims, idem, markers] = await Promise.all([
    db.collection('finance_revenue_schedules').limit(10000).get(),
    db.collection('finance_recognition_runs').limit(5000).get(),
    db.collection('finance_revenue_recognition_audit').limit(20000).get(),
    db.collection('finance_revenue_recognition_claims').limit(20000).get(),
    db.collection('finance_revenue_recognition_idempotency').limit(20000).get(),
    db.collection('finance_revenue_recognition_journal_markers').limit(10000).get(),
  ])
  const store = createEmptyRevenueRecognitionStore()
  store.schedules = asMap<RevenueSchedule>(schedules)
  store.recognitionRuns = asMap<RecognitionRun>(runs)
  store.auditEvents = asMap<RevenueRecognitionAuditEvent>(audits)
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
  for (const doc of markers.docs) {
    const data = doc.data() as {
      id?: string
      purpose?: string
      balanced?: true
      externalEgressAllowed?: false
    }
    const id = data.id || doc.id
    store.journalMarkers.set(id, {
      id,
      purpose: data.purpose || 'revenue.recognition',
      balanced: true,
      externalEgressAllowed: false,
    })
  }
  return store
}

async function saveStore(before: RevenueRecognitionStore, after: RevenueRecognitionStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops += 1
  }
  for (const [id, value] of after.schedules) touch('finance_revenue_schedules', id, value, before.schedules.get(id))
  for (const [id, value] of after.recognitionRuns) touch('finance_recognition_runs', id, value, before.recognitionRuns.get(id))
  for (const [id, value] of after.auditEvents) touch('finance_revenue_recognition_audit', id, value, before.auditEvents.get(id))
  for (const [id, value] of after.journalMarkers) {
    touch('finance_revenue_recognition_journal_markers', id, value, before.journalMarkers.get(id))
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(db.collection('finance_revenue_recognition_claims').doc(claimId), {
      id: claimId,
      key,
      createdAt: new Date().toISOString(),
    }, { merge: true })
    ops += 1
  }
  for (const [key, value] of after.idempotency) {
    if (before.idempotency.get(key)?.resultId === value.resultId) continue
    const id = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(db.collection('finance_revenue_recognition_idempotency').doc(id), {
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

const defaultPoster: RecognitionJournalPoster = async (input) => {
  const { run, journalEntryId, purpose, actor } = input
  const now = new Date().toISOString()
  const byAccount = new Map<string, { debitMinor: number; creditMinor: number; description: string }>()

  const applyLines = (
    lines: Array<{ accountId: string; debitMinor: number; creditMinor: number; description: string }>,
  ) => {
    for (const line of lines) {
      const key = `${line.debitMinor > 0 ? 'dr' : 'cr'}:${line.accountId}`
      const cur = byAccount.get(key) || { debitMinor: 0, creditMinor: 0, description: line.description }
      cur.debitMinor += line.debitMinor
      cur.creditMinor += line.creditMinor
      byAccount.set(key, cur)
    }
  }

  const byPair = new Map<string, number>()
  for (const item of run.items) {
    if (item.amountMinor <= 0) continue
    const key = `${item.deferredRevenueAccountId}|${item.revenueAccountId}`
    byPair.set(key, (byPair.get(key) || 0) + item.amountMinor)
  }
  for (const [pair, amount] of byPair) {
    const [deferred, revenue] = pair.split('|')
    if (purpose === 'revenue.recognition_reversal') {
      applyLines(buildReversalJournalLines({
        deferredRevenueAccountId: deferred,
        revenueAccountId: revenue,
        amountMinor: amount,
        description: `Reverse ${run.description}`,
      }))
    } else {
      applyLines(buildRecognitionJournalLines({
        deferredRevenueAccountId: deferred,
        revenueAccountId: revenue,
        amountMinor: amount,
        description: run.description,
      }))
    }
  }

  let debit = 0
  let credit = 0
  const lineDocs: object[] = []
  for (const [, line] of byAccount) {
    debit += line.debitMinor
    credit += line.creditMinor
    lineDocs.push(line)
  }
  if (debit !== credit) {
    throw new Error('Revenue recognition journal is not balanced')
  }

  const marker = {
    id: journalEntryId,
    orgId: run.orgId,
    legalEntityId: run.legalEntityId,
    bookId: run.bookId,
    purpose,
    recognitionRunId: run.id,
    periodKey: run.periodKey,
    totalMinor: debit,
    balanced: true as const,
    lines: lineDocs,
    actorUid: actor.uid,
    createdAt: now,
    externalEgressAllowed: false as const,
    sarsSubmissionInitiated: false as const,
    externalPaymentInitiated: false as const,
    contentHash: createHash('sha256').update(JSON.stringify(lineDocs)).digest('hex'),
  }
  await adminDb.collection('finance_revenue_recognition_journal_markers').doc(journalEntryId).set(marker, { merge: true })
  return { id: journalEntryId, balanced: true as const }
}

export class FirestoreFinanceRevenueRecognitionGateway {
  private service() {
    return new RevenueRecognitionService(loadStore, saveStore, defaultPoster)
  }

  createSchedule(actor: FinanceActorContext, command: CreateRevenueScheduleCommand) {
    return this.service().createSchedule(actor, command)
  }
  activateSchedule(actor: FinanceActorContext, command: ActivateRevenueScheduleCommand) {
    return this.service().activateSchedule(actor, command)
  }
  cancelSchedule(actor: FinanceActorContext, command: CancelRevenueScheduleCommand) {
    return this.service().cancelSchedule(actor, command)
  }
  createRecognitionRun(actor: FinanceActorContext, command: CreateRecognitionRunCommand) {
    return this.service().createRecognitionRun(actor, command)
  }
  calculateRecognitionRun(actor: FinanceActorContext, command: CalculateRecognitionRunCommand) {
    return this.service().calculateRecognitionRun(actor, command)
  }
  postRecognitionRun(actor: FinanceActorContext, command: PostRecognitionRunCommand) {
    return this.service().postRecognitionRun(actor, command)
  }
  reverseRecognitionRun(actor: FinanceActorContext, command: ReverseRecognitionRunCommand) {
    return this.service().reverseRecognitionRun(actor, command)
  }
  listBundle(actor: FinanceActorContext, scope: FinanceScope) {
    return this.service().getBundle(actor, scope)
  }
  getSchedule(actor: FinanceActorContext, scope: FinanceScope, scheduleId: string) {
    return this.service().getSchedule(actor, scope, scheduleId)
  }
  getRecognitionRun(actor: FinanceActorContext, scope: FinanceScope, runId: string) {
    return this.service().getRecognitionRun(actor, scope, runId)
  }
  deferredRevenueReport(actor: FinanceActorContext, scope: FinanceScope, asOfPeriodKey: string) {
    return this.service().deferredRevenueReport(actor, scope, asOfPeriodKey)
  }
  recognizedVsBilledReport(actor: FinanceActorContext, scope: FinanceScope, asOfPeriodKey: string) {
    return this.service().recognizedVsBilledReport(actor, scope, asOfPeriodKey)
  }
}

// Keep clone helper referenced for type stability in tests/tools.
void cloneRevenueRecognitionStore
