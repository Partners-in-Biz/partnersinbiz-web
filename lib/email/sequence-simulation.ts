// lib/email/sequence-simulation.ts
//
// Pure, deterministic, client-safe simulation of an enrollment walking a
// sequence. Used by the "Preview enrollment" feature in the visual builder
// (US-107). No Firestore, no network — it evaluates the configured steps +
// branch rules against an operator-supplied "scenario" of contact signals.
//
// This mirrors the runtime cron logic (app/api/cron/sequences) closely enough
// to give operators an accurate picture of the path a contact would take,
// without any side effects.

import type {
  SequenceStep,
  SequenceBranch,
  SequenceGoal,
  BranchCondition,
  WaitCondition,
} from '@/lib/sequences/types'

/**
 * The signals an operator toggles to drive the simulation. Each maps to a
 * BranchCondition / WaitCondition kind. Because the real evaluation reads live
 * send history + CRM state, the preview lets the operator assert "what if the
 * contact opened / clicked / replied / has tag X" per step.
 */
export interface SimulationScenario {
  /** Per-step engagement assertions (keyed by stepNumber). */
  opened: Record<number, boolean>
  clicked: Record<number, boolean>
  replied: Record<number, boolean>
  /** Substrings the simulated contact "clicked" — matches clicked-link rules. */
  clickedLinks: string[]
  /** Tags the simulated contact carries. */
  tags: string[]
  /** CRM stage of the simulated contact. */
  stage: string
  /** Wait-until conditions the operator asserts are currently satisfied. */
  waitSatisfied: Record<number, boolean>
}

export function emptyScenario(): SimulationScenario {
  return {
    opened: {},
    clicked: {},
    replied: {},
    clickedLinks: [],
    tags: [],
    stage: '',
    waitSatisfied: {},
  }
}

export type SimEventKind =
  | 'send-email'
  | 'send-sms'
  | 'wait'
  | 'wait-timeout'
  | 'branch'
  | 'goal-exit'
  | 'branch-exit'
  | 'completed'
  | 'cycle-detected'

export interface SimEvent {
  kind: SimEventKind
  stepNumber: number
  label: string
  detail?: string
  /** Cumulative days elapsed at this event. */
  dayOffset: number
}

export interface SimulationResult {
  events: SimEvent[]
  /** Final outcome summary. */
  outcome: string
  /** Steps that were actually reached (for highlighting in the builder). */
  visitedSteps: number[]
}

function evalBranchCondition(c: BranchCondition, step: number, s: SimulationScenario): boolean {
  switch (c.kind) {
    case 'opened':
      return !!s.opened[step]
    case 'not-opened':
      return !s.opened[step]
    case 'clicked':
      return !!s.clicked[step]
    case 'not-clicked':
      return !s.clicked[step]
    case 'clicked-link':
      return s.clickedLinks.some((l) => l.includes(c.urlSubstring) || c.urlSubstring.includes(l))
    case 'contact-has-tag':
      return s.tags.includes(c.tag)
    case 'contact-at-stage':
      return s.stage === c.stage
    case 'replied':
      return !!s.replied[step]
    case 'days-since-step':
      // In a deterministic preview we treat the delay as satisfied.
      return true
    default:
      return false
  }
}

function evalWaitCondition(c: WaitCondition, step: number, s: SimulationScenario): boolean {
  switch (c.kind) {
    case 'contact-tag-added':
      return s.tags.includes(c.tag)
    case 'contact-stage-reached':
      return s.stage === c.stage
    case 'business-hours':
    case 'day-of-week':
    case 'goal-hit':
      // Operator asserts these per-step via waitSatisfied; default false.
      return !!s.waitSatisfied[step]
    default:
      return !!s.waitSatisfied[step]
  }
}

function describeCondition(c: BranchCondition): string {
  switch (c.kind) {
    case 'clicked-link':
      return `clicked link containing "${c.urlSubstring}"`
    case 'contact-has-tag':
      return `has tag "${c.tag}"`
    case 'contact-at-stage':
      return `at stage "${c.stage}"`
    case 'days-since-step':
      return `${c.days} days since step`
    default:
      return c.kind.replace(/-/g, ' ')
  }
}

const MAX_ITERATIONS = 100

/**
 * Walk the sequence deterministically. Mirrors the cron's order of operations:
 * goal check → wait gate → send → branch eval → linear advance.
 */
export function simulateEnrollment(
  steps: SequenceStep[],
  scenario: SimulationScenario,
  goals?: SequenceGoal[],
): SimulationResult {
  const events: SimEvent[] = []
  const visited: number[] = []
  let dayOffset = 0
  let current = 0
  let outcome = 'Completed all steps'

  if (steps.length === 0) {
    return { events, outcome: 'No steps configured', visitedSteps: [] }
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (current < 0) {
      outcome = 'Exited (branch sent contact out of sequence)'
      break
    }
    if (current >= steps.length) {
      events.push({ kind: 'completed', stepNumber: current, label: 'Sequence complete', dayOffset })
      outcome = 'Completed all steps'
      break
    }

    // Cycle guard.
    if (visited.includes(current)) {
      events.push({
        kind: 'cycle-detected',
        stepNumber: current,
        label: 'Cycle detected — enrollment would exit',
        detail: `Step ${current + 1} was already visited`,
        dayOffset,
      })
      outcome = 'Exited (cycle detected)'
      break
    }

    const step = steps[current]

    // Goal check (before every send).
    const hitGoal = (goals ?? []).find((g) => evalBranchCondition(g.condition, current, scenario))
    if (hitGoal) {
      events.push({
        kind: 'goal-exit',
        stepNumber: current,
        label: `Goal hit: ${hitGoal.label}`,
        detail: hitGoal.exitReason || 'Enrollment exits immediately',
        dayOffset,
      })
      outcome = `Exited on goal "${hitGoal.label}"`
      break
    }

    // Apply this step's delay.
    dayOffset += step.delayDays ?? 0

    // Wait-until gate.
    if (step.waitUntil) {
      const met = evalWaitCondition(step.waitUntil.condition, current, scenario)
      if (!met) {
        events.push({
          kind: 'wait',
          stepNumber: current,
          label: `Waiting on: ${step.waitUntil.condition.kind.replace(/-/g, ' ')}`,
          detail: `Up to ${step.waitUntil.maxWaitDays} days, then ${step.waitUntil.onTimeout}`,
          dayOffset,
        })
        if (step.waitUntil.onTimeout === 'exit') {
          dayOffset += step.waitUntil.maxWaitDays
          events.push({
            kind: 'wait-timeout',
            stepNumber: current,
            label: 'Wait timed out — enrollment exits',
            dayOffset,
          })
          outcome = 'Exited (wait-until timeout)'
          break
        }
        // onTimeout === 'send' → fall through after the max wait.
        dayOffset += step.waitUntil.maxWaitDays
      }
    }

    visited.push(current)

    // Send.
    const channel = step.channel ?? 'email'
    events.push({
      kind: channel === 'sms' ? 'send-sms' : 'send-email',
      stepNumber: current,
      label:
        channel === 'sms'
          ? `Send SMS`
          : `Send email: ${step.subject?.trim() || '(no subject)'}`,
      detail: channel === 'sms' ? step.smsBody?.slice(0, 80) : undefined,
      dayOffset,
    })

    // Branch eval (after send).
    const branch = step.branch as SequenceBranch | undefined
    if (branch && branch.rules.length > 0) {
      let next = branch.defaultNextStepNumber
      let matchedLabel = 'default path'
      for (const rule of branch.rules) {
        if (evalBranchCondition(rule.condition, current, scenario)) {
          next = rule.nextStepNumber
          matchedLabel = describeCondition(rule.condition)
          break
        }
      }
      events.push({
        kind: next < 0 ? 'branch-exit' : 'branch',
        stepNumber: current,
        label:
          next < 0
            ? `Branch (${matchedLabel}) → exit`
            : `Branch (${matchedLabel}) → step ${next + 1}`,
        dayOffset,
      })
      current = next
      continue
    }

    // Linear advance.
    current += 1
  }

  if (events.length >= MAX_ITERATIONS) {
    outcome = 'Stopped (max simulation depth)'
  }

  return { events, outcome, visitedSteps: visited }
}
