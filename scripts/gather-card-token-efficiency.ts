/**
 * Gather card-level token efficiency for Kanban agent runs.
 *
 * Reads hermes_runs where conversationId = `kanban-task:<taskId>` (the watcher's
 * dispatch convention), groups by task, and reports planned prompt input tokens
 * (from the persisted promptLedger) plus gateway-reported usage when present.
 *
 * This is the before/after instrument for the fleet token-burn work:
 *   - baseline doc (fleet_token_efficiency/baseline) is captured on first run.
 *   - latest doc (fleet_token_efficiency/latest) is refreshed every run.
 * After a real project day on the new prompt caps, re-run and compare.
 *
 * Run:
 *   npx tsx scripts/gather-card-token-efficiency.ts [--days 7] [--org pib-platform-owner]
 *
 * Requires .env.local with Firebase Admin vars.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Load .env.local before importing firebase-admin (mirrors other PiB scripts)
// ---------------------------------------------------------------------------
;(function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf-8')
  const lines = raw.split('\n')
  let currentKey = ''
  let currentVal = ''
  let inMultiline = false
  for (const line of lines) {
    if (inMultiline) {
      currentVal += '\n' + line
      if (line.includes('"')) {
        inMultiline = false
        const val = currentVal.replace(/^"|"$/g, '').replace(/\\n/g, '\n')
        if (!process.env[currentKey]) process.env[currentKey] = val
        currentKey = ''
        currentVal = ''
      }
      continue
    }
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if (val.startsWith('"') && !val.slice(1).includes('"')) {
      currentKey = key
      currentVal = val
      inMultiline = true
      continue
    }
    val = val.replace(/^"|"$/g, '').replace(/\\n/g, '\n')
    if (!process.env[key]) process.env[key] = val
  }
})()

const args = process.argv.slice(2)
const daysArg = args.find((a) => a.startsWith('--days=')) ?? args[args.indexOf('--days') + 1]
const orgArg = args.find((a) => a.startsWith('--org=')) ?? args[args.indexOf('--org') + 1]
const forceBaseline = args.includes('--force-baseline')
const WINDOW_DAYS = Number(daysArg && !Number.isNaN(Number(daysArg)) ? daysArg : 7)
const ORG_ID = orgArg || 'pib-platform-owner'
const RUNS_COLLECTION = 'hermes_runs'
const KANBAN_PREFIX = 'kanban-task:'

type RunRow = {
  runDocId: string
  taskId: string
  status: string
  model: string
  provider: string
  reasoningEffort: string
  agentId: string
  createdAtMs: number
  plannedTokens: number | null
  usageInputTokens: number | null
  usageTotalTokens: number | null
}

function toMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value === 'object') {
    const t = value as { seconds?: number; toMillis?: () => number }
    if (typeof t.toMillis === 'function') return t.toMillis()
    if (typeof t.seconds === 'number') return t.seconds * 1000
  }
  return null
}

function plannedTokensFromLedger(ledger: unknown): number | null {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return null
  const row = ledger as Record<string, unknown>
  if (typeof row.inputTokens === 'number' && Number.isFinite(row.inputTokens)) return row.inputTokens
  if (Array.isArray(row.blocks)) {
    const sum = row.blocks
      .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>).inputTokens : null))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .reduce((a, b) => a + b, 0)
    if (sum > 0) return sum
  }
  return null
}

function usageTokensFromDoc(doc: Record<string, unknown>): { input: number | null; total: number | null } {
  const usage = doc.usage && typeof doc.usage === 'object' && !Array.isArray(doc.usage)
    ? (doc.usage as Record<string, unknown>)
    : null
  if (!usage) return { input: null, total: null }
  const input =
    typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
      ? usage.inputTokens
      : typeof usage.input_tokens === 'number' && Number.isFinite(usage.input_tokens)
        ? usage.input_tokens
        : null
  const total =
    typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens)
        ? usage.total_tokens
        : null
  return { input, total }
}

async function main() {
  const { adminDb } = await import('@/lib/firebase/admin')
  const cutoffMs = Date.now() - WINDOW_DAYS * 86_400_000

  console.log(`[gather-card-token-efficiency] org=${ORG_ID} window=${WINDOW_DAYS}d cutoff=${new Date(cutoffMs).toISOString()}`)

  const runsSnapshot = await adminDb
    .collection(RUNS_COLLECTION)
    .where('conversationId', '>=', KANBAN_PREFIX)
    .where('conversationId', '<', 'kanban-task;')
    .get()

  const rows: RunRow[] = []
  for (const doc of runsSnapshot.docs) {
    const d = doc.data()
    const conversationId = typeof d.conversationId === 'string' ? d.conversationId : ''
    if (!conversationId.startsWith(KANBAN_PREFIX)) continue
    const createdAtMs = toMillis(d.createdAt)
    if (!createdAtMs || createdAtMs < cutoffMs) continue
    const ledger = d.promptLedger && typeof d.promptLedger === 'object'
      ? d.promptLedger
      : d.metadata && typeof d.metadata === 'object' && !Array.isArray(d.metadata)
        ? (d.metadata as Record<string, unknown>).contextLedger
        : null
    const usage = usageTokensFromDoc(d)
    rows.push({
      runDocId: doc.id,
      taskId: conversationId.slice(KANBAN_PREFIX.length),
      status: typeof d.status === 'string' ? d.status : 'unknown',
      model: typeof d.model === 'string' ? d.model : '',
      provider: typeof d.provider === 'string' ? d.provider : '',
      reasoningEffort: typeof d.reasoningEffort === 'string' ? d.reasoningEffort : '',
      agentId: typeof d.dispatchAgentId === 'string' ? d.dispatchAgentId : '',
      createdAtMs,
      plannedTokens: plannedTokensFromLedger(ledger),
      usageInputTokens: usage.input,
      usageTotalTokens: usage.total,
    })
  }

  console.log(`[gather] ${rows.length} kanban-task runs in window`)

  if (rows.length === 0) {
    console.log('No kanban-task runs found in window — nothing to baseline yet.')
    return
  }

  // -------------------------------------------------------------------------
  // Per-task rollups
  // -------------------------------------------------------------------------
  const byTask = new Map<string, RunRow[]>()
  for (const row of rows) {
    const list = byTask.get(row.taskId) ?? []
    list.push(row)
    byTask.set(row.taskId, list)
  }

  const taskIds = [...byTask.keys()].slice(0, 60)
  const titleById = new Map<string, string>()
  for (let i = 0; i < taskIds.length; i += 10) {
    const chunk = taskIds.slice(i, i + 10)
    try {
      const snap = await adminDb.collection('tasks').where('__name__', 'in', chunk).get()
      snap.forEach((s) => titleById.set(s.id, typeof s.data().title === 'string' ? s.data().title : s.id))
    } catch {
      // best-effort title lookup; keep ids only
    }
  }

  const cardRows = [...byTask.entries()]
    .map(([taskId, runs]) => {
      const completed = runs.filter((r) => r.status === 'completed').length
      const failed = runs.filter((r) => ['failed', 'lost', 'cancelled', 'canceled', 'stopped', 'interrupted'].includes(r.status)).length
      const planned = runs.map((r) => r.plannedTokens).filter((v): v is number => v !== null)
      const usageIn = runs.map((r) => r.usageInputTokens).filter((v): v is number => v !== null)
      const models = new Map<string, number>()
      for (const r of runs) {
        const key = r.provider && r.model ? `${r.provider}/${r.model}` : 'unknown'
        models.set(key, (models.get(key) ?? 0) + 1)
      }
      const topModel = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
      return {
        taskId,
        title: titleById.get(taskId) ?? taskId,
        runs: runs.length,
        completed,
        failed,
        totalPlanned: planned.reduce((a, b) => a + b, 0),
        avgPlanned: planned.length > 0 ? Math.round(planned.reduce((a, b) => a + b, 0) / planned.length) : 0,
        maxPlanned: planned.length > 0 ? Math.max(...planned) : 0,
        usageInput: usageIn.reduce((a, b) => a + b, 0),
        topModel,
      }
    })
    .sort((a, b) => b.totalPlanned - a.totalPlanned)

  // -------------------------------------------------------------------------
  // Fleet + per-agent totals
  // -------------------------------------------------------------------------
  const plannedAll = rows.map((r) => r.plannedTokens).filter((v): v is number => v !== null)
  const usageAll = rows.map((r) => r.usageInputTokens).filter((v): v is number => v !== null)
  const completedRuns = rows.filter((r) => r.status === 'completed').length
  const fleet = {
    windowDays: WINDOW_DAYS,
    orgId: ORG_ID,
    runAt: new Date().toISOString(),
    runs: rows.length,
    completedRuns,
    failedRuns: rows.length - completedRuns,
    cards: byTask.size,
    plannedInputTokens: plannedAll.reduce((a, b) => a + b, 0),
    avgPlannedInputTokensPerRun: plannedAll.length > 0 ? Math.round(plannedAll.reduce((a, b) => a + b, 0) / plannedAll.length) : 0,
    avgPlannedInputTokensPerCompletedRun: plannedAll.length > 0 ? Math.round(plannedAll.reduce((a, b) => a + b, 0) / Math.max(1, completedRuns)) : 0,
    ledgerCoverage: Math.round((plannedAll.length / Math.max(1, rows.length)) * 100),
    usageInputTokens: usageAll.reduce((a, b) => a + b, 0),
    usageCoverage: Math.round((usageAll.length / Math.max(1, rows.length)) * 100),
  }

  const byAgent = new Map<string, RunRow[]>()
  for (const row of rows) {
    const key = row.agentId || 'unknown'
    const list = byAgent.get(key) ?? []
    list.push(row)
    byAgent.set(key, list)
  }
  const agentTotals = [...byAgent.entries()]
    .map(([agentId, runs]) => {
      const planned = runs.map((r) => r.plannedTokens).filter((v): v is number => v !== null)
      const usageIn = runs.map((r) => r.usageInputTokens).filter((v): v is number => v !== null)
      return {
        agentId,
        runs: runs.length,
        completed: runs.filter((r) => r.status === 'completed').length,
        plannedInputTokens: planned.reduce((a, b) => a + b, 0),
        avgPlanned: planned.length > 0 ? Math.round(planned.reduce((a, b) => a + b, 0) / planned.length) : 0,
        usageInputTokens: usageIn.reduce((a, b) => a + b, 0),
      }
    })
    .sort((a, b) => b.plannedInputTokens - a.plannedInputTokens)

  // -------------------------------------------------------------------------
  // Output: console + CSV + Firestore baseline/latest
  // -------------------------------------------------------------------------
  console.log('\n=== Fleet summary ===')
  console.log(JSON.stringify(fleet, null, 2))

  console.log('\n=== Per-agent totals ===')
  for (const a of agentTotals) {
    console.log(`${a.agentId.padEnd(16)} runs=${String(a.runs).padStart(4)} completed=${String(a.completed).padStart(4)} plannedIn=${String(a.plannedInputTokens).padStart(12)} avg=${String(a.avgPlanned).padStart(8)} usageIn=${String(a.usageInputTokens).padStart(12)}`)
  }

  console.log('\n=== Per-card (sorted by planned input tokens) ===')
  console.log(`${'taskId'.padEnd(24)} ${'title'.slice(0, 28).padEnd(28)} ${'runs'.padStart(4)} ${'done'.padStart(4)} ${'fail'.padStart(4)} ${'plannedIn'.padStart(12)} ${'avg'.padStart(8)} ${'max'.padStart(8)} ${'model'.padEnd(34)}`)
  for (const c of cardRows.slice(0, 40)) {
    console.log(`${c.taskId.padEnd(24)} ${c.title.slice(0, 28).padEnd(28)} ${String(c.runs).padStart(4)} ${String(c.completed).padStart(4)} ${String(c.failed).padStart(4)} ${String(c.totalPlanned).padStart(12)} ${String(c.avgPlanned).padStart(8)} ${String(c.maxPlanned).padStart(8)} ${c.topModel.padEnd(34)}`)
  }

  const artifactsDir = resolve(process.cwd(), 'scripts/artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  const dateStamp = new Date().toISOString().slice(0, 10)
  const csvPath = resolve(artifactsDir, `card-token-efficiency-${dateStamp}.csv`)
  const header = 'taskId,title,runs,completed,failed,totalPlannedInputTokens,avgPlannedInputTokens,maxPlannedInputTokens,usageInputTokens,topModel'
  const csvLines = [header, ...cardRows.map((c) =>
    [c.taskId, `"${c.title.replace(/"/g, '""')}"`, c.runs, c.completed, c.failed, c.totalPlanned, c.avgPlanned, c.maxPlanned, c.usageInput, `"${c.topModel}"`].join(','),
  )]
  writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf-8')
  console.log(`\nCSV written: ${csvPath}`)

  const baselineRef = adminDb.collection('fleet_token_efficiency').doc('baseline')
  const latestRef = adminDb.collection('fleet_token_efficiency').doc('latest')
  const baselineDoc = await baselineRef.get()
  if (!baselineDoc.exists || forceBaseline) {
    await baselineRef.set({ ...fleet, capturedAt: new Date().toISOString(), note: 'Before prompt-cap instrumentation (or forced refresh).' }, { merge: true })
    console.log('Baseline captured (first run in this window).')
  } else {
    console.log(`Baseline exists from ${baselineDoc.data()?.capturedAt ?? 'earlier'}; kept.`)
  }
  await latestRef.set({ ...fleet, topCards: cardRows.slice(0, 20), agentTotals }, { merge: true })
  console.log('Latest summary written to fleet_token_efficiency/latest.')
}

main().catch((err) => {
  console.error('[gather-card-token-efficiency] failed', err)
  process.exit(1)
})
