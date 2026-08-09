/**
 * Design Finish Gate — fresh-reviewer verdict types.
 *
 * The finish gate (research ZTTo7g6CU80u1uUSZvoC recommendation P2) is the
 * rule that a web/design/Studio task cannot be marked done by its builder.
 * Before done, a SEPARATE review pass in a FRESH context (never the builder
 * thread, never self-grading) looks at the delivered surface (screenshots /
 * Studio artifact) against the brief contract and returns a verdict:
 *
 *   ship    — every promise in the brief contract is resolved as claimed.
 *   fix     — some promises are partial; the builder may iterate, at most
 *             `maxFixRounds` (default 2) rounds.
 *   rebuild — at least one promise is unresolved, or fix rounds are
 *             exhausted; the task goes back before it can be claimed done.
 *
 * Scoring is promise-by-promise: each promise in the contract is graded
 * resolved | partial | unresolved against the screenshot/artifact evidence.
 */

export type PromiseScore = 'resolved' | 'partial' | 'unresolved'
export type FinishVerdict = 'ship' | 'fix' | 'rebuild'

/** One commitment in the brief contract, graded by the fresh reviewer. */
export interface ReviewPromise {
  /** Stable id, e.g. p1, p2 — referenced by the reviewer's scores. */
  id: string
  /** Human-readable promise text from the brief/scope. */
  label: string
  /** Acceptance bar: what "done" means for this promise. */
  contract?: string
}

/** The brief contract the finished surface is graded against. */
export interface ReviewContract {
  schema: 'pib-design-finish-gate/v1'
  taskId?: string
  projectId?: string
  orgId?: string
  title: string
  brief: string
  promises: ReviewPromise[]
  /** Screenshot / artifact evidence paths the reviewer inspects. */
  screenshots: string[]
  /** Optional per-screenshot vision transcripts (ModLens etc). */
  visionTranscripts?: Record<string, string>
  /** The agent that built the work — the reviewer must differ. */
  builderAgentId: string
  /** Fresh-context reviewer instructions (self-contained prompt). */
  reviewerPrompt: string
  /** Current review round (1-based). Fix consumes a round. */
  round: number
  /** Maximum fix rounds before the gate escalates to rebuild. */
  maxFixRounds: number
  /** When the contract was built (ISO). */
  createdAt: string
}

/** The fresh reviewer's structured verdict. */
export interface ReviewerOutput {
  verdict: FinishVerdict
  /** Promise id -> score + evidence note. */
  promiseScores: Record<string, { score: PromiseScore; note?: string }>
  strengths: string[]
  concerns: string[]
  fixRequests: string[]
  /** The reviewing agent — MUST differ from contract.builderAgentId. */
  reviewerAgentId: string
  /** Free-form evidence citation (screenshot file, region, line). */
  evidence?: string
  reviewerNote?: string
}

/** Aggregated, round-enforced gate result. */
export interface FinishGateReport {
  schema: 'pib-design-finish-gate/v1'
  verdict: FinishVerdict
  /** 0 ship / 2 fix (rounds remain) / 3 rebuild / 1 failure. */
  exitCode: 0 | 1 | 2 | 3
  round: number
  maxFixRounds: number
  roundsRemaining: number
  promises: Array<{
    id: string
    label: string
    score: PromiseScore
    note?: string
  }>
  summary: {
    resolved: number
    partial: number
    unresolved: number
    total: number
  }
  strengths: string[]
  concerns: string[]
  fixRequests: string[]
  reviewerAgentId: string
  /** True when the reviewer was rejected for self-grading. */
  selfGradedRejected: boolean
  at: string
}

export interface FinishGateInput {
  contract: ReviewContract
  reviewer: ReviewerOutput
  /** Optional override; defaults to contract.round. */
  round?: number
}

export const FINISH_GATE_SCHEMA = 'pib-design-finish-gate/v1' as const
export const DEFAULT_MAX_FIX_ROUNDS = 2
export const REVIEWER_PROMPT_SCHEMA = 'pib-design-finish-gate-reviewer/v1' as const
