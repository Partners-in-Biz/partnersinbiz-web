'use client'

import { useCallback, useState } from 'react'
import type { SequenceStep, SequenceBranch, WaitUntil } from '@/lib/sequences/types'
import type { PreflightReport } from '@/lib/email/preflight'
import BranchEditor from './BranchEditor'
import WaitUntilEditor from './WaitUntilEditor'
import PreflightPanel from '@/components/email/PreflightPanel'
import { countSmsSegments } from '@/lib/sms/segments'

interface Props {
  steps: SequenceStep[]
  onChange: (steps: SequenceStep[]) => void
  /**
   * Sequence id is required to call the per-step preflight endpoint. When
   * omitted (e.g. on an unsaved new sequence), the preflight section hides.
   */
  sequenceId?: string
}

const EMPTY_STEP: Omit<SequenceStep, 'stepNumber'> = {
  delayDays: 1,
  subject: '',
  bodyHtml: '',
  bodyText: '',
}

export default function StepEditor({ steps, onChange, sequenceId }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [preflightReports, setPreflightReports] = useState<Record<number, PreflightReport | null>>({})
  const [preflightLoading, setPreflightLoading] = useState<Record<number, boolean>>({})

  const runPreflight = useCallback(
    async (stepIdx: number) => {
      if (!sequenceId) return
      setPreflightLoading((p) => ({ ...p, [stepIdx]: true }))
      try {
        const r = await fetch(
          `/api/v1/sequences/${sequenceId}/steps/${stepIdx}/preflight`,
          { method: 'POST' },
        )
        const b = await r.json()
        if (r.ok && b?.data?.report) {
          setPreflightReports((p) => ({ ...p, [stepIdx]: b.data.report as PreflightReport }))
        }
      } finally {
        setPreflightLoading((p) => ({ ...p, [stepIdx]: false }))
      }
    },
    [sequenceId],
  )

  function addStep() {
    const next: SequenceStep = { ...EMPTY_STEP, stepNumber: steps.length + 1 }
    onChange([...steps, next])
    setExpanded(steps.length)
  }

  function updateStep<K extends keyof SequenceStep>(
    index: number,
    field: K,
    value: SequenceStep[K],
  ) {
    const updated = steps.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    onChange(updated)
  }

  function removeStep(index: number) {
    const updated = steps
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, stepNumber: i + 1 }))
    onChange(updated)
    if (expanded === index) setExpanded(null)
  }

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i} className="rounded-xl border border-outline-variant overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-surface-container text-left"
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <span className="text-sm font-medium text-on-surface">
              Step {step.stepNumber}: {step.subject || '(no subject)'}
              {step.branch && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-primary-container text-on-primary-container">
                  branched
                </span>
              )}
              {step.waitUntil && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-tertiary-container text-on-tertiary-container">
                  wait
                </span>
              )}
            </span>
            <span className="text-xs text-on-surface-variant">
              {step.delayDays === 0 ? 'Immediately' : `+${step.delayDays}d`}
            </span>
          </button>
          {expanded === i && (
            <div className="p-4 bg-surface space-y-3 border-t border-outline-variant">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-on-surface-variant font-medium">Channel:</span>
                  <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateStep(i, 'channel', 'email')}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        (step.channel ?? 'email') === 'email'
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => updateStep(i, 'channel', 'sms')}
                      className={`px-2.5 py-1 text-xs font-medium border-l border-outline-variant transition-colors ${
                        step.channel === 'sms'
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      SMS
                    </button>
                  </div>
                </div>
              </div>

              {step.channel === 'sms' ? (
                <>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Delay (days)</label>
                    <input
                      type="number"
                      min={0}
                      value={step.delayDays}
                      onChange={(e) => updateStep(i, 'delayDays', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">SMS body</label>
                    <textarea
                      value={step.smsBody ?? ''}
                      onChange={(e) => updateStep(i, 'smsBody', e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono"
                      placeholder="Hi {{firstName}}, a short SMS. Reply STOP to opt out."
                    />
                    {(() => {
                      const seg = countSmsSegments(step.smsBody ?? '')
                      return (
                        <div className="mt-1 flex items-center justify-between text-xs text-on-surface-variant">
                          <span>
                            {seg.characters} chars · {seg.segments} segment
                            {seg.segments === 1 ? '' : 's'} · {seg.encoding.toUpperCase()}
                          </span>
                          {seg.segments > 1 && (
                            <span className="text-amber-600 dark:text-amber-400">
                              Multi-segment SMS bills per segment.
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-on-surface-variant mb-1">Subject</label>
                      <input
                        value={step.subject}
                        onChange={(e) => updateStep(i, 'subject', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-xs font-medium text-on-surface-variant mb-1">Delay (days)</label>
                      <input
                        type="number"
                        min={0}
                        value={step.delayDays}
                        onChange={(e) => updateStep(i, 'delayDays', parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Body (plain text)</label>
                    <textarea
                      value={step.bodyText}
                      onChange={(e) => {
                        updateStep(i, 'bodyText', e.target.value)
                        updateStep(i, 'bodyHtml', `<p>${e.target.value.replace(/\n/g, '</p><p>')}</p>`)
                      }}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono"
                    />
                  </div>
                  {sequenceId && (
                    <PreflightPanel
                      report={preflightReports[i] ?? null}
                      loading={preflightLoading[i] ?? false}
                      onRefresh={() => runPreflight(i)}
                    />
                  )}
                </>
              )}

              <WaitUntilEditor
                value={step.waitUntil}
                onChange={(v: WaitUntil | undefined) => updateStep(i, 'waitUntil', v)}
              />

              <BranchEditor
                branch={step.branch}
                totalSteps={steps.length}
                currentStepIndex={i}
                onChange={(b: SequenceBranch | undefined) => updateStep(i, 'branch', b)}
              />

              <button
                onClick={() => removeStep(i)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove step
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={addStep}
        className="w-full py-2 rounded-xl border border-dashed border-outline-variant text-sm text-on-surface-variant hover:bg-surface-container transition-colors"
      >
        + Add step
      </button>
    </div>
  )
}
