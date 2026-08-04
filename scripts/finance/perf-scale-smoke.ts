/**
 * Finance scale / bulk performance smoke.
 *
 * Targets:
 * - 10k-line statement CSV parse wall time
 * - recon suggestion generation on large unmatched sets (amount-indexed)
 * - list pagination does not return the full line array
 * - hard gates: never auto-post
 *
 * Usage: npx tsx scripts/finance/perf-scale-smoke.ts
 * Exit 0 on pass; non-zero on fail. Writes JSON evidence under artifacts/finance/perf/.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FinanceActorContext } from '../../lib/finance/types'
import {
  StatementFinanceService,
  createEmptyStatementStore,
  type StatementFinanceStore,
} from '../../lib/finance/statements/service'
import { parseStatementFile } from '../../lib/finance/statements/parse'
import { paginateArray } from '../../lib/finance/scale/pagination'
import {
  bestPaymentMatch,
  indexPaymentsByAbsAmount,
} from '../../lib/finance/scale/recon-index'

function actor(): FinanceActorContext {
  return {
    uid: 'perf_u1',
    orgId: 'org_perf',
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg1',
        orgId: 'org_perf',
        userId: 'perf_u1',
        legalEntityId: 'le_1',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6
}

function buildCsv(lineCount: number): string {
  const rows = ['date,amount,description,reference']
  for (let i = 0; i < lineCount; i++) {
    const amt = i % 3 === 0 ? (100 + (i % 50)).toFixed(2) : `-${(50 + (i % 40)).toFixed(2)}`
    rows.push(`2026-08-01,${amt},Txn ${i},REF-${i}`)
  }
  return rows.join('\n')
}

async function main() {
  const results: Record<string, unknown> = {
    host: process.env.HOSTNAME || 'local',
    startedAt: new Date().toISOString(),
    autoPosted: false,
    externalPaymentInitiated: false,
  }
  const failures: string[] = []

  // --- Pure parse 10k ---
  const csv10k = buildCsv(10_000)
  let t0 = process.hrtime.bigint()
  const parsed = parseStatementFile(csv10k, 'csv')
  const parseMs = ms(t0)
  results.parse10k = { lines: parsed.lines.length, ms: Math.round(parseMs) }
  if (parsed.lines.length !== 10_000) failures.push('parse10k line count')
  if (parseMs > 15_000) failures.push(`parse10k too slow: ${parseMs}ms`)

  // --- Domain parse + list page ---
  const storeRef: { current: StatementFinanceStore } = { current: createEmptyStatementStore() }
  const svc = new StatementFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    async (input) => ({ id: input.id }),
    () => '2026-08-03T12:00:00.000Z',
  )
  const admin = actor()
  t0 = process.hrtime.bigint()
  const domainParse = await svc.parseStatement(admin, {
    id: 'sib_perf_10k',
    orgId: 'org_perf',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    bankAccountId: 'bank_1',
    fileName: 'perf-10k.csv',
    contentText: csv10k,
    format: 'csv',
    requestId: 'req_perf_parse',
    idempotencyKey: 'idem_perf_parse',
  })
  const domainParseMs = ms(t0)
  results.domainParse10k = {
    lines: domainParse.lines.length,
    ms: Math.round(domainParseMs),
    status: domainParse.batch.status,
  }
  if (domainParse.batch.externalPaymentInitiated !== false) failures.push('parse externalPaymentInitiated')
  if (domainParse.lines.length !== 10_000) failures.push('domain parse line count')
  if (domainParseMs > 30_000) failures.push(`domain parse too slow: ${domainParseMs}ms`)

  t0 = process.hrtime.bigint()
  const list = await svc.listForOrg(admin, 'org_perf', { lineLimit: 100, lineOffset: 0 })
  const listMs = ms(t0)
  results.listPage = {
    returned: list.lines.length,
    total: list.totals.lines,
    hasMore: list.linePage.hasMore,
    ms: Math.round(listMs),
  }
  if (list.lines.length !== 100) failures.push('list page size')
  if (list.totals.lines !== 10_000) failures.push('list totals')
  if (!list.linePage.hasMore) failures.push('list hasMore')
  if (listMs > 5_000) failures.push(`list too slow: ${listMs}ms`)

  // --- 10k suggest path (in-memory index) ---
  const N = 10_000
  const bankTransactions = Array.from({ length: N }, (_, i) => ({
    id: `btx_${i}`,
    bankAccountId: 'bank_1',
    amountMinor: i % 2 === 0 ? -(2500 + (i % 31)) : 2500 + (i % 31),
    statementDate: '2026-08-01',
    description: i % 40 === 0 ? `Client paid REF-${i}` : `Misc ${i}`,
    reference: i % 40 === 0 ? `REF-${i}` : undefined,
    reconciliationState: 'unmatched' as const,
  }))
  const payments = Array.from({ length: 2_000 }, (_, i) => ({
    id: `pay_${i}`,
    amountMinor: 2500 + (i % 31),
    description: `Client paid REF-${i * 40}`,
    externalReference: `REF-${i * 40}`,
    status: 'verified' as const,
  }))

  t0 = process.hrtime.bigint()
  const byAbs = indexPaymentsByAbsAmount(payments)
  let matches = 0
  const used = new Set<string>()
  for (const txn of bankTransactions) {
    const best = bestPaymentMatch(txn, byAbs, used)
    if (best && best.score >= 0.75) {
      used.add(best.paymentId)
      matches++
    }
  }
  const indexMs = ms(t0)
  results.reconIndex10k = { ms: Math.round(indexMs), matches, payments: payments.length }
  if (indexMs > 5_000) failures.push(`recon index too slow: ${indexMs}ms`)

  t0 = process.hrtime.bigint()
  const suggestions = await svc.generateSuggestions(admin, {
    orgId: 'org_perf',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    bankAccountId: 'bank_1',
    bankTransactions,
    payments,
    requestId: 'req_perf_suggest',
    idempotencyKey: 'idem_perf_suggest',
    idPrefix: 'rsg_perf',
  })
  const suggestMs = ms(t0)
  results.suggest10k = {
    ms: Math.round(suggestMs),
    count: suggestions.suggestions.length,
    autoPosted: suggestions.autoPosted,
  }
  if (suggestions.autoPosted !== false) failures.push('suggest autoPosted')
  if (suggestions.suggestions.length !== N) failures.push('suggest count')
  if (suggestMs > 45_000) failures.push(`suggest10k too slow: ${suggestMs}ms`)

  // --- Pagination unit ---
  const page = paginateArray(Array.from({ length: 10_000 }, (_, i) => i), { limit: 100, offset: 900 })
  results.paginate = page
  if (page.items.length !== 100 || page.total !== 10_000 || page.items[0] !== 900) {
    failures.push('paginateArray')
  }

  results.failures = failures
  results.ok = failures.length === 0
  results.finishedAt = new Date().toISOString()

  const outDir = join(process.cwd(), 'artifacts/finance/perf')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `scale-smoke-${Date.now()}.json`)
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  console.log(`evidence: ${outPath}`)
  if (failures.length > 0) {
    console.error('FAIL', failures)
    process.exit(1)
  }
  console.log('PASS finance scale/perf smoke')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
