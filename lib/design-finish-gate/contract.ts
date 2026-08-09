/**
 * Finish gate contract construction — turn a task brief + evidence into a
 * ReviewContract with a self-contained fresh-reviewer prompt.
 *
 * The contract is the "brief vs screenshot" pair: promises are extracted from
 * the task brief (or supplied explicitly), screenshots/artifacts are the
 * evidence the fresh reviewer inspects, and the reviewerPrompt is a complete
 * instruction set for a FRESH context — it must never be answered by the
 * builder's own thread.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  DEFAULT_MAX_FIX_ROUNDS,
  FINISH_GATE_SCHEMA,
  REVIEWER_PROMPT_SCHEMA,
  type ReviewContract,
  type ReviewPromise,
} from './types'

export interface BuildContractInput {
  taskId?: string
  projectId?: string
  orgId?: string
  title: string
  brief: string
  /** Explicit promises win; otherwise extracted from the brief. */
  promises?: ReviewPromise[]
  screenshots?: string[]
  visionTranscripts?: Record<string, string>
  builderAgentId: string
  round?: number
  maxFixRounds?: number
}

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/
/** A promise-looking line: starts with a bullet and reads as a commitment. */
const PROMISE_VERB = /\b(?:build|ship|deliver|add|implement|create|make|ensure|fix|support|use|run|return|render|include|provide|expose|allow|reject|resolve|read|write|record|verify|land|compose|publish|draft|design|redesign|polish|typeset|layout|colorize|audit|critique|harden|distill|clarify|bolder|quieter|animate|optimize|onboard|adapt|shape|init|document|extract)\b/i

/** Extract promise candidates from a markdown brief (bullet lines). */
export function extractPromises(brief: string): ReviewPromise[] {
  const seen = new Set<string>()
  const out: ReviewPromise[] = []
  for (const rawLine of brief.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!BULLET.test(line)) continue
    const label = line.replace(BULLET, '').trim()
    if (!label || label.length < 4 || label.length > 240) continue
    // Skip pure structural bullets (headers/notes) — a promise should read
    // as something the delivered surface can be checked against.
    if (/^(?:scope|status|source|note|see|priority|owner|task|theo|quinn|q[12])\b/i.test(label)) continue
    // Require a commitment verb OR a concrete deliverable noun so random
    // list lines don't become promises.
    if (!PROMISE_VERB.test(label) && !/\b(?:card|flow|route|surface|hook|gate|engine|rule|page|url|action|waiver|run|session|variant|decision)\b/i.test(label)) continue
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ id: `p${out.length + 1}`, label, contract: label })
  }
  return out
}

/** Build the self-contained fresh-reviewer prompt for a contract. */
export function buildReviewerPrompt(contract: ReviewContract): string {
  const shots = contract.screenshots.length
    ? contract.screenshots.map((s) => `- ${s}`).join('\n')
    : '(none supplied — reviewer must note the absence in every score)'
  const vision = contract.visionTranscripts
    ? Object.entries(contract.visionTranscripts)
        .map(([file, text]) => `--- vision transcript for ${file} ---\n${text.slice(0, 4000)}`)
        .join('\n\n')
    : ''
  const promises = contract.promises
    .map((p) => `- ${p.id}: ${p.label}${p.contract && p.contract !== p.label ? ` (contract: ${p.contract})` : ''}`)
    .join('\n')

  return [
    `You are a FRESH design reviewer for Partners in Biz. You did NOT build this work,`,
    `you have no memory of the builder's session, and you must never grade your own work.`,
    `You are the finish gate: the task cannot be marked done until you return a verdict.`,
    ``,
    `Task: ${contract.title}`,
    contract.taskId ? `Task id: ${contract.taskId}` : '',
    contract.projectId ? `Project id: ${contract.projectId}` : '',
    ``,
    `## Brief contract`,
    contract.brief.slice(0, 6000),
    ``,
    `## Promises to grade (promise-by-promise)`,
    promises,
    ``,
    `## Evidence to inspect (screenshots / artifacts)`,
    shots,
    vision ? `\n## Vision transcripts (ModLens OCR + layout)\n${vision}` : '',
    ``,
    `## Your job`,
    `For EVERY promise p1..pN, compare the evidence against the brief contract and`,
    `score it exactly one of: resolved (fully delivered as claimed) / partial`,
    `(delivered but with visible gaps vs the contract) / unresolved (missing or wrong).`,
    `Then return ONE verdict:`,
    `- ship — every promise resolved; the work matches the brief contract.`,
    `- fix — some promises partial; specific, actionable fix requests; the builder`,
    `  may iterate (the gate allows at most ${contract.maxFixRounds} fix rounds).`,
    `- rebuild — at least one promise unresolved, or the surface does not implement`,
    `  the brief at all; the task goes back to the builder for a real redo.`,
    ``,
    `## Output contract`,
    `Reply with ONLY a JSON object, schema ${REVIEWER_PROMPT_SCHEMA}:`,
    `{`,
    `  "verdict": "ship" | "fix" | "rebuild",`,
    `  "promiseScores": { "p1": { "score": "resolved"|"partial"|"unresolved", "note": "evidence citation" }, ... },`,
    `  "strengths": ["..."],`,
    `  "concerns": ["..."],`,
    `  "fixRequests": ["..."],`,
    `  "reviewerAgentId": "your agent id",`,
    `  "evidence": "which screenshot/artifact you actually inspected"`,
    `}`,
    ``,
    `Rules: score EVERY promise; never fabricate evidence you did not see; if the`,
    `screenshots are missing or unreadable, mark affected promises unresolved and say`,
    `so. You are not the builder — do not grade leniently to help anyone finish.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export interface BuildContractResult {
  contract: ReviewContract
}

/** Assemble a ReviewContract from task inputs (extracts promises by default). */
export function buildContract(input: BuildContractInput): ReviewContract {
  const promises = input.promises?.length ? input.promises : extractPromises(input.brief)
  const round = input.round ?? 1
  const maxFixRounds = input.maxFixRounds ?? DEFAULT_MAX_FIX_ROUNDS
  const contract: ReviewContract = {
    schema: FINISH_GATE_SCHEMA,
    taskId: input.taskId,
    projectId: input.projectId,
    orgId: input.orgId,
    title: input.title,
    brief: input.brief,
    promises,
    screenshots: input.screenshots ?? [],
    visionTranscripts: input.visionTranscripts,
    builderAgentId: input.builderAgentId,
    reviewerPrompt: '', // filled below
    round,
    maxFixRounds,
    createdAt: new Date().toISOString(),
  }
  contract.reviewerPrompt = buildReviewerPrompt(contract)
  return contract
}

/** Absolute screenshot paths that exist (skips missing, keeps order). */
export function resolveScreenshots(paths: string[]): string[] {
  return paths.filter((p) => fs.existsSync(p)).map((p) => path.resolve(p))
}
