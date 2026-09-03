'use client'

// components/admin/sequences/SequenceTreeView.tsx
//
// Read-only tree visualisation of a sequence. Renders each step as a card
// and draws an arrow for each branch rule plus a dashed line for "default
// next". Pure CSS / SVG  -  no graph library needed.

import type { SequenceStep, BranchCondition } from '@/lib/sequences/types'

interface Props {
  steps: SequenceStep[]
}

function describeCondition(c: BranchCondition): string {
  switch (c.kind) {
    case 'opened':
      return 'opened this step'
    case 'not-opened':
      return "didn't open this step"
    case 'clicked':
      return 'clicked something in this step'
    case 'not-clicked':
      return "didn't click anything"
    case 'clicked-link':
      return `clicked link containing "${c.urlSubstring}"`
    case 'contact-has-tag':
      return `tagged "${c.tag}"`
    case 'contact-at-stage':
      return `at stage "${c.stage}"`
    case 'replied':
      return 'replied'
    case 'days-since-step':
      return `${c.days} day(s) elapsed`
  }
}

function arrowLabel(nextStepNumber: number, stepsLen: number): string {
  if (nextStepNumber < 0) return 'EXIT'
  if (nextStepNumber >= stepsLen) return 'COMPLETE'
  return `→ Step ${nextStepNumber + 1}`
}

export default function SequenceTreeView({ steps }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className="text-sm text-[var(--color-pib-text-muted)] italic">
        Add steps to see the journey.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const branch = step.branch
        const wait = step.waitUntil
        return (
          <div key={i} className="space-y-2">
            <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-[var(--color-pib-text)]">
                  Step {i + 1}: {step.subject || '(no subject)'}
                </div>
                <div className="text-xs text-[var(--color-pib-text-muted)] whitespace-nowrap">
                  {step.delayDays === 0 ? 'Immediately' : `+${step.delayDays}d`}
                </div>
              </div>
              {wait && (
                <div className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
                  ⏳ Wait until <strong>{wait.condition.kind}</strong> · max{' '}
                  {wait.maxWaitDays}d · on timeout: {wait.onTimeout}
                </div>
              )}
            </div>

            {branch ? (
              <div className="ml-6 space-y-1">
                {branch.rules.map((rule, ri) => (
                  <div
                    key={ri}
                    className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]"
                  >
                    <span className="inline-block w-4 border-t border-[var(--color-pib-line)]" />
                    <span>
                      <strong>IF</strong> {describeCondition(rule.condition)} (after{' '}
                      {rule.evaluateAfterDays}d)
                    </span>
                    <span className="font-mono text-[var(--color-pib-text)]">
                      {arrowLabel(rule.nextStepNumber, steps.length)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                  <span className="inline-block w-4 border-t border-dashed border-[var(--color-pib-line)]" />
                  <span>
                    <strong>ELSE</strong> (default)
                  </span>
                  <span className="font-mono text-[var(--color-pib-text)]">
                    {arrowLabel(branch.defaultNextStepNumber, steps.length)}
                  </span>
                </div>
              </div>
            ) : (
              i < steps.length - 1 && (
                <div className="ml-6 flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                  <span className="inline-block w-4 border-t border-[var(--color-pib-line)]" />
                  <span className="font-mono">→ Step {i + 2}</span>
                </div>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
