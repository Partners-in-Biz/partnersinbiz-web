import { createHash } from 'node:crypto'

const CONFIDENCE_THRESHOLD = 95
const ASSUMPTIONS_ATTESTATION = 'PLAN WITH ASSUMPTIONS'
const INSPECTION_KEYS = ['brief', 'docs', 'files', 'plan', 'tasks', 'tools', 'agents', 'skills'] as const
const BRIEF_ARRAY_KEYS = ['successCriteria', 'constraints', 'outOfScope', 'assumptions', 'risks', 'approvalGates'] as const

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    )
  }
  return value
}

function normalizedBrief(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const outcome = clean(source.outcome)
  const user = clean(source.user)
  const whyNow = clean(source.whyNow)
  if (!outcome || !user || !whyNow) return null
  const arrays = Object.fromEntries(BRIEF_ARRAY_KEYS.map((key) => [
    key,
    Array.isArray(source[key]) ? Array.from(new Set((source[key] as unknown[]).map(clean).filter(Boolean))) : [],
  ]))
  if (BRIEF_ARRAY_KEYS.some((key) => (arrays[key] as string[]).length === 0)) return null
  return { outcome, user, whyNow, ...arrays }
}

function completeInspection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const inspection = value as Record<string, unknown>
  return INSPECTION_KEYS.every((key) => Array.isArray(inspection[key]) && (inspection[key] as unknown[]).some((item) => clean(item)))
    && Boolean(clean(inspection.inspectedBy) && clean(inspection.inspectedAt))
}

function completedInterviewTurns(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.filter((turn) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return false
    const source = turn as Record<string, unknown>
    return Boolean(clean(source.answer) && clean(source.answeredBy) && clean(source.answeredAt))
  }).length
}

export function isWatcherPlanningReady(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  const brief = normalizedBrief(state.brief)
  if (state.schemaVersion !== 1 || !Number.isInteger(state.revision) || Number(state.revision) <= 0) return false
  if (clean(state.pendingQuestionId)) return false
  if (state.enforced !== true || !brief || !clean(state.digest)) return false
  const digest = createHash('sha256').update(JSON.stringify(stable(brief))).digest('hex')
  if (digest !== state.digest || !completeInspection(state.inspection)) return false

  if (state.status === 'confirmed' && state.mode === 'interview') {
    return typeof state.confidence === 'number'
      && state.confidence >= CONFIDENCE_THRESHOLD
      && completedInterviewTurns(state.turns) > 0
      && Array.isArray(state.predictedNextAnswers)
      && state.predictedNextAnswers.length === 3
      && state.predictedNextAnswers.every((answer) => clean(answer).length > 0)
      && Array.isArray(state.intentBlockingUnknowns)
      && state.intentBlockingUnknowns.length === 0
      && Boolean(clean(state.confirmedBy) && clean(state.confirmedAt))
  }

  if (state.status === 'assumptions_attested' && state.mode === 'assumptions') {
    return state.attestation === ASSUMPTIONS_ATTESTATION
      && clean(state.attestationReason).length >= 10
      && state.acknowledgesPreservedOperationalGates === true
      && Boolean(clean(state.confirmedBy) && clean(state.confirmedAt))
  }

  return false
}
