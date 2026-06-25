// app/api/v1/admin/hermes/metrics/route.ts
//
// US-317 — Per-agent Hermes performance metrics for the operator control plane.
//
// Reads real Hermes run records from the `hermes_runs` Firestore collection and
// computes, per agent (Hermes profile):
//   - response time avg + p95 (createdAt → completedAt/updatedAt for finished runs)
//   - success rate (completed vs failed/lost/timed_out)
//   - run volume (and a status breakdown)
//   - token usage (from each run's persisted Hermes `usage` payload, OpenAI- or
//     Anthropic-shaped)
//   - cost (only when Hermes persisted a cost figure on the run — never fabricated)
//
// Query params:
//   ?days=N        — lookback window in days (default 30, max 180)
//   ?agentId=ID    — restrict to a single agent
//   ?format=csv    — stream a CSV export instead of JSON
//
// Auth: admin (withAuth). JSON envelope: { success, data }. CSV returns raw text.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { AGENT_IDS, isValidAgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

const COMPLETED = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'finished'])
const FAILED = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled', 'stopped', 'interrupted', 'lost', 'timed_out'])

function tsToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch { /* noop */ } }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime() } catch { /* noop */ } }
    const seconds = v.seconds ?? v._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Find a usage object nested anywhere shallow inside the run response. */
function findUsage(response: unknown, depth = 0): Record<string, unknown> | null {
  const obj = asObject(response)
  if (!obj) return null
  const direct = asObject(obj.usage)
  if (direct) return direct
  if (depth >= 3) return null
  for (const key of ['result', 'response', 'data', 'run', 'output', 'message']) {
    if (key in obj) {
      const nested = findUsage(obj[key], depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

interface RunUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  costUsd: number | null
}

/** Extract token + cost from a run, tolerating OpenAI / Anthropic / custom shapes. */
function extractUsage(response: unknown): RunUsage {
  const usage = findUsage(response)
  if (!usage) return { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null }

  const input = num(usage.input_tokens) ?? num(usage.inputTokens) ?? num(usage.prompt_tokens) ?? num(usage.promptTokens)
  const output = num(usage.output_tokens) ?? num(usage.outputTokens) ?? num(usage.completion_tokens) ?? num(usage.completionTokens)
  let total = num(usage.total_tokens) ?? num(usage.totalTokens)
  if (total == null && input != null && output != null) total = input + output

  const costUsd =
    num(usage.cost_usd) ?? num(usage.costUsd) ?? num(usage.cost) ??
    num((asObject(response) ?? {}).cost_usd) ?? num((asObject(response) ?? {}).costUsd)

  return { inputTokens: input, outputTokens: output, totalTokens: total, costUsd }
}

function agentIdFromProfile(profile: unknown): string {
  const raw = typeof profile === 'string' && profile.trim() ? profile.trim() : 'unknown'
  return raw.replace(/-main$/i, '').replace(/^agent:/i, '') || 'unknown'
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null
  if (sortedAsc.length === 1) return sortedAsc[0]
  const rank = (p / 100) * (sortedAsc.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo)
}

interface AgentAccumulator {
  agentId: string
  total: number
  completed: number
  failed: number
  other: number
  durations: number[]
  inputTokens: number
  outputTokens: number
  totalTokens: number
  tokenRuns: number
  costUsd: number
  costRuns: number
  lastRunAt: number | null
}

interface AgentMetrics {
  agentId: string
  runVolume: number
  completed: number
  failed: number
  inProgressOrOther: number
  successRate: number | null
  avgResponseMs: number | null
  p95ResponseMs: number | null
  tokens: { input: number; output: number; total: number; runsWithUsage: number }
  cost: { usd: number | null; runsWithCost: number }
  lastRunAt: string | null
}

function finalize(acc: AgentAccumulator): AgentMetrics {
  const durations = acc.durations.slice().sort((a, b) => a - b)
  const avg = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null
  const decided = acc.completed + acc.failed
  return {
    agentId: acc.agentId,
    runVolume: acc.total,
    completed: acc.completed,
    failed: acc.failed,
    inProgressOrOther: acc.other,
    successRate: decided > 0 ? acc.completed / decided : null,
    avgResponseMs: avg != null ? Math.round(avg) : null,
    p95ResponseMs: durations.length ? Math.round(percentile(durations, 95) as number) : null,
    tokens: { input: acc.inputTokens, output: acc.outputTokens, total: acc.totalTokens, runsWithUsage: acc.tokenRuns },
    cost: { usd: acc.costRuns > 0 ? Number(acc.costUsd.toFixed(4)) : null, runsWithCost: acc.costRuns },
    lastRunAt: acc.lastRunAt != null ? new Date(acc.lastRunAt).toISOString() : null,
  }
}

function csvCell(value: string | number | null): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(rows: AgentMetrics[]): string {
  const header = [
    'agent_id', 'run_volume', 'completed', 'failed', 'in_progress_or_other', 'success_rate_pct',
    'avg_response_ms', 'p95_response_ms', 'input_tokens', 'output_tokens', 'total_tokens',
    'runs_with_usage', 'cost_usd', 'runs_with_cost', 'last_run_at',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.agentId,
      r.runVolume,
      r.completed,
      r.failed,
      r.inProgressOrOther,
      r.successRate != null ? (r.successRate * 100).toFixed(1) : '',
      r.avgResponseMs ?? '',
      r.p95ResponseMs ?? '',
      r.tokens.input,
      r.tokens.output,
      r.tokens.total,
      r.tokens.runsWithUsage,
      r.cost.usd ?? '',
      r.cost.runsWithCost,
      r.lastRunAt ?? '',
    ].map(csvCell).join(','))
  }
  return lines.join('\n')
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  const url = new URL(req.url)
  const daysParam = Number(url.searchParams.get('days') ?? '30')
  const days = Math.min(Math.max(1, Number.isFinite(daysParam) ? daysParam : 30), 180)
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000
  const format = url.searchParams.get('format')
  const agentFilter = url.searchParams.get('agentId')?.trim() || ''

  // No orderBy → avoids a composite-index requirement; window-filter in memory.
  const snap = await adminDb.collection('hermes_runs').limit(8000).get()

  const accumulators = new Map<string, AgentAccumulator>()
  const ensure = (agentId: string): AgentAccumulator => {
    let acc = accumulators.get(agentId)
    if (!acc) {
      acc = {
        agentId, total: 0, completed: 0, failed: 0, other: 0, durations: [],
        inputTokens: 0, outputTokens: 0, totalTokens: 0, tokenRuns: 0, costUsd: 0, costRuns: 0, lastRunAt: null,
      }
      accumulators.set(agentId, acc)
    }
    return acc
  }

  let runsConsidered = 0
  for (const doc of snap.docs) {
    const d = doc.data()
    const createdMs = tsToMillis(d.createdAt)
    if (createdMs != null && createdMs < sinceMs) continue

    const agentId = agentIdFromProfile(d.profile)
    if (agentFilter && agentId !== agentFilter) continue

    runsConsidered += 1
    const acc = ensure(agentId)
    acc.total += 1

    const status = (typeof d.status === 'string' ? d.status : 'unknown').toLowerCase()
    const isCompleted = COMPLETED.has(status)
    const isFailed = FAILED.has(status)
    if (isCompleted) acc.completed += 1
    else if (isFailed) acc.failed += 1
    else acc.other += 1

    // Response time only meaningful for finished runs with both timestamps.
    if ((isCompleted || isFailed) && createdMs != null) {
      const endMs = tsToMillis(d.completedAt) ?? tsToMillis(d.updatedAt)
      if (endMs != null && endMs >= createdMs) acc.durations.push(endMs - createdMs)
    }

    const usage = extractUsage(d.response)
    if (usage.totalTokens != null || usage.inputTokens != null || usage.outputTokens != null) {
      acc.inputTokens += usage.inputTokens ?? 0
      acc.outputTokens += usage.outputTokens ?? 0
      acc.totalTokens += usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))
      acc.tokenRuns += 1
    }
    if (usage.costUsd != null) {
      acc.costUsd += usage.costUsd
      acc.costRuns += 1
    }

    const lastMs = tsToMillis(d.updatedAt) ?? createdMs
    if (lastMs != null && (acc.lastRunAt == null || lastMs > acc.lastRunAt)) acc.lastRunAt = lastMs
  }

  // Ensure every known agent appears (zeroed) when not filtering.
  if (!agentFilter) {
    for (const id of AGENT_IDS) ensure(id)
  } else if (isValidAgentId(agentFilter)) {
    ensure(agentFilter)
  }

  const agents = Array.from(accumulators.values())
    .map(finalize)
    .sort((a, b) => b.runVolume - a.runVolume || a.agentId.localeCompare(b.agentId))

  if (format === 'csv') {
    const csv = buildCsv(agents)
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="hermes-agent-metrics-${days}d.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const totals = agents.reduce(
    (t, a) => {
      t.runVolume += a.runVolume
      t.completed += a.completed
      t.failed += a.failed
      t.totalTokens += a.tokens.total
      if (a.cost.usd != null) t.costUsd += a.cost.usd
      return t
    },
    { runVolume: 0, completed: 0, failed: 0, totalTokens: 0, costUsd: 0 },
  )
  const decided = totals.completed + totals.failed

  return apiSuccess({
    window: { days, sinceIso: new Date(sinceMs).toISOString() },
    summary: {
      runsConsidered,
      runVolume: totals.runVolume,
      completed: totals.completed,
      failed: totals.failed,
      successRate: decided > 0 ? totals.completed / decided : null,
      totalTokens: totals.totalTokens,
      totalCostUsd: totals.costUsd > 0 ? Number(totals.costUsd.toFixed(4)) : null,
      activeAgents: agents.filter((a) => a.runVolume > 0).length,
    },
    agents,
    generatedAt: new Date().toISOString(),
  })
})
