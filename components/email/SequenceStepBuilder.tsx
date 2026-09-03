// components/email/SequenceStepBuilder.tsx
//
// Visual send / wait / branch builder for an email+SMS sequence (US-107).
// Edits an array of SequenceStep in place via onChange. Each step exposes:
//   - channel (email / sms) + content
//   - delayDays (the "wait before this step" timing)
//   - an optional wait-until gate (WaitUntil)
//   - an optional branch (SequenceBranch) evaluated after the step sends
'use client'

import type {
  SequenceStep,
  SequenceBranch,
  SequenceBranchRule,
  BranchCondition,
  WaitUntil,
  WaitCondition,
} from '@/lib/sequences/types'
import { Icon } from '@/components/studio'

interface Props {
  steps: SequenceStep[]
  onChange: (steps: SequenceStep[]) => void
}

const BRANCH_CONDITION_KINDS: BranchCondition['kind'][] = [
  'opened',
  'not-opened',
  'clicked',
  'not-clicked',
  'clicked-link',
  'contact-has-tag',
  'contact-at-stage',
  'replied',
  'days-since-step',
]

const WAIT_CONDITION_KINDS: WaitCondition['kind'][] = [
  'business-hours',
  'day-of-week',
  'contact-tag-added',
  'contact-stage-reached',
  'goal-hit',
]

function inputCls(extra = ''): string {
  return `w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)] ${extra}`
}

function defaultBranchCondition(kind: BranchCondition['kind']): BranchCondition {
  switch (kind) {
    case 'clicked-link':
      return { kind, urlSubstring: '' }
    case 'contact-has-tag':
      return { kind, tag: '' }
    case 'contact-at-stage':
      return { kind, stage: '' }
    case 'days-since-step':
      return { kind, days: 3 }
    default:
      return { kind } as BranchCondition
  }
}

function defaultWaitCondition(kind: WaitCondition['kind']): WaitCondition {
  switch (kind) {
    case 'business-hours':
      return { kind, startHourLocal: 9, endHourLocal: 17 }
    case 'day-of-week':
      return { kind, daysOfWeek: [1, 2, 3, 4, 5] }
    case 'contact-tag-added':
      return { kind, tag: '' }
    case 'contact-stage-reached':
      return { kind, stage: '' }
    case 'goal-hit':
      return { kind, goalId: '' }
    default:
      return { kind } as unknown as WaitCondition
  }
}

export default function SequenceStepBuilder({ steps, onChange }: Props) {
  function updateStep(idx: number, patch: Partial<SequenceStep>) {
    onChange(steps.map((s, i) => (i === idx ? { ...s, ...patch, stepNumber: i } : s)))
  }

  function addStep(channel: 'email' | 'sms') {
    const next: SequenceStep = {
      stepNumber: steps.length,
      delayDays: steps.length === 0 ? 0 : 2,
      subject: '',
      bodyHtml: '',
      bodyText: '',
      channel,
      smsBody: channel === 'sms' ? '' : undefined,
    }
    onChange([...steps, next])
  }

  function removeStep(idx: number) {
    onChange(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i })))
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= steps.length) return
    const copy = [...steps]
    ;[copy[idx], copy[target]] = [copy[target], copy[idx]]
    onChange(copy.map((s, i) => ({ ...s, stepNumber: i })))
  }

  // ── Wait-until editing ──────────────────────────────────────────────────
  function setWaitUntil(idx: number, waitUntil: WaitUntil | undefined) {
    updateStep(idx, { waitUntil })
  }

  // ── Branch editing ──────────────────────────────────────────────────────
  function setBranch(idx: number, branch: SequenceBranch | undefined) {
    updateStep(idx, { branch })
  }

  function addBranchRule(idx: number) {
    const step = steps[idx]
    const branch: SequenceBranch = step.branch ?? { rules: [], defaultNextStepNumber: idx + 1 }
    const rule: SequenceBranchRule = {
      condition: { kind: 'opened' },
      nextStepNumber: idx + 1,
      evaluateAfterDays: 1,
    }
    setBranch(idx, { ...branch, rules: [...branch.rules, rule] })
  }

  function updateBranchRule(idx: number, ruleIdx: number, patch: Partial<SequenceBranchRule>) {
    const step = steps[idx]
    if (!step.branch) return
    const rules = step.branch.rules.map((r, i) => (i === ruleIdx ? { ...r, ...patch } : r))
    setBranch(idx, { ...step.branch, rules })
  }

  function removeBranchRule(idx: number, ruleIdx: number) {
    const step = steps[idx]
    if (!step.branch) return
    const rules = step.branch.rules.filter((_, i) => i !== ruleIdx)
    setBranch(idx, { ...step.branch, rules })
  }

  return (
    <div className="space-y-3">
      {steps.map((step, idx) => {
        const channel = step.channel ?? 'email'
        return (
          <div key={idx} className="bento-card !p-0 overflow-hidden">
            {/* Header: timing + channel + controls */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-pib-line)] bg-black/10 px-4 py-3">
              <span aria-hidden="true" className="!h-7 !w-7 text-xs font-medium">
                {idx + 1}
              </span>
              <div className="flex items-center gap-1.5">
                <Icon name="schedule" className="text-[15px] text-[var(--color-pib-text-muted)]" />
                <span className="text-xs text-[var(--color-pib-text-muted)]">Wait</span>
                <input aria-label="Wait"
                  type="number"
                  min={0}
                  value={step.delayDays}
                  onChange={(e) => updateStep(idx, { delayDays: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                  className="w-16 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-xs outline-none focus:border-[var(--color-pib-accent)]"
                />
                <span className="text-xs text-[var(--color-pib-text-muted)]">days, then</span>
              </div>
              <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-pib-line)]">
                {(['email', 'sms'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => updateStep(idx, { channel: ch, smsBody: ch === 'sms' ? step.smsBody ?? '' : step.smsBody })}
                    className={[
                      'cursor-pointer px-3 py-1 text-xs capitalize transition-colors',
                      channel === ch
                        ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-text)]'
                        : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.03]',
                    ].join(' ')}
                  >
                    {ch === 'email' ? 'Send email' : 'Send SMS'}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveStep(idx, -1)}
                  disabled={idx === 0}
                  title="Move up"
                  className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] disabled:opacity-30"
                >
                  <Icon name="arrow_upward" className="text-[16px]" />
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(idx, 1)}
                  disabled={idx === steps.length - 1}
                  title="Move down"
                  className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] disabled:opacity-30"
                >
                  <Icon name="arrow_downward" className="text-[16px]" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(idx)}
                  title="Delete step"
                  className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-red-400/[0.08] hover:text-[var(--st-danger)]"
                >
                  <Icon name="delete" className="text-[16px]" />
                </button>
              </div>
            </div>

            {/* Body: content */}
            <div className="space-y-3 p-4">
              {channel === 'email' ? (
                <>
                  <div>
                    <label className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Subject</label>
                    <input aria-label="Welcome to {{orgName}}"
                      value={step.subject}
                      onChange={(e) => updateStep(idx, { subject: e.target.value })}
                      placeholder="Welcome to {{orgName}}"
                      className={inputCls()}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Body (HTML)</label>
                    <textarea
                      aria-label="Email body HTML"
                      value={step.bodyHtml}
                      onChange={(e) => updateStep(idx, { bodyHtml: e.target.value, bodyText: e.target.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })}
                      rows={4}
                      placeholder="<p>Hi {{firstName}}, ...</p>"
                      className={inputCls('font-mono text-xs')}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">SMS message</label>
                  <textarea aria-label="Hi {{firstName}}, thanks for joining!"
                    value={step.smsBody ?? ''}
                    onChange={(e) => updateStep(idx, { smsBody: e.target.value })}
                    rows={3}
                    placeholder="Hi {{firstName}}, thanks for joining!"
                    className={inputCls('text-sm')}
                  />
                </div>
              )}

              {/* Wait-until gate */}
              <WaitUntilEditor
                value={step.waitUntil}
                onChange={(wu) => setWaitUntil(idx, wu)}
              />

              {/* Branch */}
              <div className="rounded-lg border border-[var(--color-pib-line)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Icon name="account_tree" className="text-[15px] text-[var(--sc-accent)]" />
                    <span className="text-xs font-medium">Branch after this step</span>
                  </div>
                  {step.branch ? (
                    <button
                      type="button"
                      onClick={() => setBranch(idx, undefined)}
                      className="cursor-pointer text-[11px] text-[var(--color-pib-text-muted)] hover:text-red-300"
                    >
                      Remove branch
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addBranchRule(idx)}
                      className="cursor-pointer text-[11px] text-[var(--color-pib-accent)] hover:underline"
                    >
                      + Add branch rule
                    </button>
                  )}
                </div>

                {step.branch && (
                  <div className="mt-3 space-y-2">
                    {step.branch.rules.map((rule, ruleIdx) => (
                      <div key={ruleIdx} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-pib-line)] bg-black/10 px-2.5 py-2">
                        <span className="text-[11px] text-[var(--color-pib-text-muted)]">If</span>
                        <select aria-label="Kind"
                          value={rule.condition.kind}
                          onChange={(e) =>
                            updateBranchRule(idx, ruleIdx, {
                              condition: defaultBranchCondition(e.target.value as BranchCondition['kind']),
                            })
                          }
                          className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                        >
                          {BRANCH_CONDITION_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k.replace(/-/g, ' ')}
                            </option>
                          ))}
                        </select>
                        {rule.condition.kind === 'clicked-link' && (
                          <input aria-label="url contains"
                            value={rule.condition.urlSubstring}
                            onChange={(e) =>
                              updateBranchRule(idx, ruleIdx, { condition: { kind: 'clicked-link', urlSubstring: e.target.value } })
                            }
                            placeholder="url contains…"
                            className="w-32 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                          />
                        )}
                        {rule.condition.kind === 'contact-has-tag' && (
                          <input aria-label="tag"
                            value={rule.condition.tag}
                            onChange={(e) =>
                              updateBranchRule(idx, ruleIdx, { condition: { kind: 'contact-has-tag', tag: e.target.value } })
                            }
                            placeholder="tag"
                            className="w-24 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                          />
                        )}
                        {rule.condition.kind === 'contact-at-stage' && (
                          <input aria-label="stage"
                            value={rule.condition.stage}
                            onChange={(e) =>
                              updateBranchRule(idx, ruleIdx, { condition: { kind: 'contact-at-stage', stage: e.target.value } })
                            }
                            placeholder="stage"
                            className="w-24 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                          />
                        )}
                        {rule.condition.kind === 'days-since-step' && (
                          <input aria-label="stage"
                            type="number"
                            min={0}
                            value={rule.condition.days}
                            onChange={(e) =>
                              updateBranchRule(idx, ruleIdx, { condition: { kind: 'days-since-step', days: parseInt(e.target.value || '0', 10) } })
                            }
                            className="w-16 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                          />
                        )}
                        <span className="text-[11px] text-[var(--color-pib-text-muted)]">→ go to</span>
                        <select aria-label="Next Step Number"
                          value={rule.nextStepNumber}
                          onChange={(e) => updateBranchRule(idx, ruleIdx, { nextStepNumber: parseInt(e.target.value, 10) })}
                          className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                        >
                          <option value={-1}>Exit</option>
                          {steps.map((_, sIdx) => (
                            <option key={sIdx} value={sIdx}>
                              Step {sIdx + 1}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeBranchRule(idx, ruleIdx)}
                          className="cursor-pointer ml-auto text-[var(--color-pib-text-muted)] hover:text-red-300"
                          title="Remove rule"
                        >
                          <Icon name="close" className="text-[15px]" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--color-pib-text-muted)]">Otherwise go to</span>
                      <select aria-label="Default Next Step Number"
                        value={step.branch.defaultNextStepNumber}
                        onChange={(e) => setBranch(idx, { ...step.branch!, defaultNextStepNumber: parseInt(e.target.value, 10) })}
                        className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
                      >
                        <option value={-1}>Exit</option>
                        {steps.map((_, sIdx) => (
                          <option key={sIdx} value={sIdx}>
                            Step {sIdx + 1}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addBranchRule(idx)}
                        className="cursor-pointer text-[11px] text-[var(--color-pib-accent)] hover:underline"
                      >
                        + Rule
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => addStep('email')} className="btn-pib-secondary flex items-center gap-1.5 text-sm">
          <Icon name="add" className="text-[16px]" />
          Add email step
        </button>
        <button type="button" onClick={() => addStep('sms')} className="btn-pib-secondary flex items-center gap-1.5 text-sm">
          <Icon name="sms" className="text-[16px]" />
          Add SMS step
        </button>
      </div>
    </div>
  )
}

// ── Wait-until sub-editor ─────────────────────────────────────────────────────

function WaitUntilEditor({
  value,
  onChange,
}: {
  value: WaitUntil | undefined
  onChange: (v: WaitUntil | undefined) => void
}) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon name="hourglass_top" className="text-[15px] text-[var(--st-warning)]" />
          <span className="text-xs font-medium">Wait until (before sending)</span>
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="cursor-pointer text-[11px] text-[var(--color-pib-text-muted)] hover:text-red-300"
          >
            Remove gate
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onChange({ condition: { kind: 'business-hours', startHourLocal: 9, endHourLocal: 17 }, maxWaitDays: 3, onTimeout: 'send' })}
            className="cursor-pointer text-[11px] text-[var(--color-pib-accent)] hover:underline"
          >
            + Add wait gate
          </button>
        )}
      </div>

      {value && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select aria-label="Kind"
            value={value.condition.kind}
            onChange={(e) => onChange({ ...value, condition: defaultWaitCondition(e.target.value as WaitCondition['kind']) })}
            className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
          >
            {WAIT_CONDITION_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/-/g, ' ')}
              </option>
            ))}
          </select>
          {value.condition.kind === 'contact-tag-added' && (
            <input aria-label="tag"
              value={value.condition.tag}
              onChange={(e) => onChange({ ...value, condition: { kind: 'contact-tag-added', tag: e.target.value } })}
              placeholder="tag"
              className="w-24 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
            />
          )}
          {value.condition.kind === 'contact-stage-reached' && (
            <input aria-label="stage"
              value={value.condition.stage}
              onChange={(e) => onChange({ ...value, condition: { kind: 'contact-stage-reached', stage: e.target.value } })}
              placeholder="stage"
              className="w-24 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
            />
          )}
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">max</span>
          <input aria-label="stage"
            type="number"
            min={0}
            value={value.maxWaitDays}
            onChange={(e) => onChange({ ...value, maxWaitDays: Math.max(0, parseInt(e.target.value || '0', 10)) })}
            className="w-16 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
          />
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">days, then</span>
          <select aria-label="On Timeout"
            value={value.onTimeout}
            onChange={(e) => onChange({ ...value, onTimeout: e.target.value as 'send' | 'exit' })}
            className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-[11px]"
          >
            <option value="send">send anyway</option>
            <option value="exit">exit</option>
          </select>
        </div>
      )}
    </div>
  )
}
