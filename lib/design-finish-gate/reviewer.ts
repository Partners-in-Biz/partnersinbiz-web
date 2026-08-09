/**
 * Finish gate reviewer pass — parse the fresh reviewer's structured output,
 * enforce the never-self-grade rule, aggregate promise scores into a verdict,
 * and enforce the at-most-N fix-round budget.
 */

import {
  FINISH_GATE_SCHEMA,
  type FinishGateInput,
  type FinishGateReport,
  type FinishVerdict,
  type PromiseScore,
  type ReviewerOutput,
} from './types'

export interface ParseReviewerOptions {
  /** Reject output whose reviewerAgentId equals the builder. */
  builderAgentId?: string
}

/** Tolerant JSON extraction: finds the first balanced {...} in text. */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        try {
          return JSON.parse(slice) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const VALID_VERDICTS: FinishVerdict[] = ['ship', 'fix', 'rebuild']
const VALID_SCORES: PromiseScore[] = ['resolved', 'partial', 'unresolved']

function toScore(v: unknown): PromiseScore | null {
  return typeof v === 'string' && (VALID_SCORES as string[]).includes(v) ? (v as PromiseScore) : null
}

function toVerdict(v: unknown): FinishVerdict | null {
  return typeof v === 'string' && (VALID_VERDICTS as string[]).includes(v) ? (v as FinishVerdict) : null
}

/**
 * Parse and validate a fresh reviewer's output. Returns a normalized
 * ReviewerOutput or throws with a precise reason. When builderAgentId is
 * supplied, an output whose reviewerAgentId equals the builder is rejected —
 * the builder can never grade its own work.
 */
export function parseReviewerOutput(text: string, opts: ParseReviewerOptions = {}): ReviewerOutput {
  const raw = extractJsonObject(text)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('finish-gate: reviewer output is not a JSON object')
  }
  const obj = raw as Record<string, unknown>

  const verdict = toVerdict(obj.verdict)
  if (!verdict) throw new Error(`finish-gate: invalid verdict "${String(obj.verdict)}" (ship|fix|rebuild)`)

  const promiseScoresRaw = obj.promiseScores
  if (!promiseScoresRaw || typeof promiseScoresRaw !== 'object' || Array.isArray(promiseScoresRaw)) {
    throw new Error('finish-gate: reviewer output missing promiseScores object')
  }
  const promiseScores: ReviewerOutput['promiseScores'] = {}
  for (const [id, entry] of Object.entries(promiseScoresRaw as Record<string, unknown>)) {
    const e = entry as { score?: unknown; note?: unknown }
    const score = toScore(e?.score)
    if (!score) throw new Error(`finish-gate: invalid score for ${id} ("${String(e?.score)}")`)
    promiseScores[id] = { score, note: typeof e?.note === 'string' ? e.note : undefined }
  }

  const reviewerAgentId = typeof obj.reviewerAgentId === 'string' ? obj.reviewerAgentId : ''
  if (!reviewerAgentId) throw new Error('finish-gate: reviewer output missing reviewerAgentId')
  if (opts.builderAgentId && reviewerAgentId === opts.builderAgentId) {
    throw new Error(`finish-gate: self-grade rejected — reviewerAgentId "${reviewerAgentId}" is the builder`)
  }

  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

  return {
    verdict,
    promiseScores,
    strengths: strList(obj.strengths),
    concerns: strList(obj.concerns),
    fixRequests: strList(obj.fixRequests),
    reviewerAgentId,
    evidence: typeof obj.evidence === 'string' ? obj.evidence : undefined,
    reviewerNote: typeof obj.reviewerNote === 'string' ? obj.reviewerNote : undefined,
  }
}

export interface AggregateResult {
  verdict: FinishVerdict
  summary: { resolved: number; partial: number; unresolved: number; total: number }
}

/**
 * Aggregate promise scores into a verdict:
 *   - any unresolved            -> rebuild
 *   - all resolved              -> ship
 *   - otherwise (partials)      -> fix
 * Round budget is enforced separately by buildReport (fix with 0 rounds
 * remaining escalates to rebuild).
 */
export function aggregateVerdict(reviewer: ReviewerOutput, promiseIds: string[]): AggregateResult {
  const ids = promiseIds.length ? promiseIds : Object.keys(reviewer.promiseScores)
  const counts = { resolved: 0, partial: 0, unresolved: 0 }
  for (const id of ids) {
    const score = reviewer.promiseScores[id]?.score ?? 'unresolved'
    counts[score]++
  }
  let verdict: FinishVerdict
  if (counts.unresolved > 0) verdict = 'rebuild'
  else if (counts.partial === 0) verdict = 'ship'
  else verdict = 'fix'
  return { verdict, summary: { ...counts, total: ids.length } }
}

/** Score one promise given the reviewer's map (missing -> unresolved). */
export function scoreFor(reviewer: ReviewerOutput, id: string): PromiseScore {
  return reviewer.promiseScores[id]?.score ?? 'unresolved'
}

/**
 * Build the gate report from contract + reviewer output.
 *   exit 0 ship
 *   exit 2 fix (rounds remain)
 *   exit 3 rebuild, or fix with no rounds remaining (escalated)
 *   exit 1 failure (thrown by parseReviewerOutput / validation)
 */
export function buildReport(input: FinishGateInput): FinishGateReport {
  const { contract, reviewer } = input
  const round = input.round ?? contract.round
  const maxFixRounds = contract.maxFixRounds
  const promiseIds = contract.promises.map((p) => p.id)
  const { verdict, summary } = aggregateVerdict(reviewer, promiseIds)

  let finalVerdict = verdict
  if (verdict === 'fix' && round > maxFixRounds) {
    // Budget exhausted — a fix that can't be fixed inside the budget is a rebuild.
    finalVerdict = 'rebuild'
  }

  // Evidence fail-closed (p4): a ship verdict with NO evidence — no
  // screenshots, no vision transcripts, no reviewer evidence citation — must
  // not silently pass. The reviewer's citation is real evidence; an empty
  // screenshots list is fine for code/tooling reviews that cite files.
  const requireEvidence = input.requireEvidence ?? true
  const hasEvidence =
    contract.screenshots.length > 0 ||
    (contract.visionTranscripts !== undefined && Object.keys(contract.visionTranscripts).length > 0) ||
    (typeof reviewer.evidence === 'string' && reviewer.evidence.trim().length > 0)
  const evidenceMissing = finalVerdict === 'ship' && requireEvidence && !hasEvidence

  const roundsRemaining = finalVerdict === 'ship' || finalVerdict === 'rebuild' ? 0 : Math.max(0, maxFixRounds - round)
  const exitCode: FinishGateReport['exitCode'] = evidenceMissing
    ? 1
    : finalVerdict === 'ship'
      ? 0
      : finalVerdict === 'fix'
        ? 2
        : 3

  return {
    schema: FINISH_GATE_SCHEMA,
    verdict: evidenceMissing ? 'rebuild' : finalVerdict,
    exitCode,
    round,
    maxFixRounds,
    roundsRemaining,
    promises: contract.promises.map((p) => ({
      id: p.id,
      label: p.label,
      score: scoreFor(reviewer, p.id),
      note: reviewer.promiseScores[p.id]?.note,
    })),
    summary,
    strengths: reviewer.strengths,
    concerns: reviewer.concerns,
    fixRequests: reviewer.fixRequests,
    reviewerAgentId: reviewer.reviewerAgentId,
    selfGradedRejected: false,
    at: new Date().toISOString(),
  }
}
