// components/email/EnrollmentPreview.tsx
//
// "Preview enrollment" — a pure, deterministic client-side simulation of a
// contact walking the configured sequence. The operator toggles per-step
// signals (opened / clicked / replied), contact tags/stage, and wait
// conditions, then sees exactly which steps + branches they'd hit.
'use client'

import { useMemo, useState } from 'react'
import type { SequenceStep, SequenceGoal } from '@/lib/sequences/types'
import {
  simulateEnrollment,
  emptyScenario,
  type SimulationScenario,
  type SimEvent,
} from '@/lib/email/sequence-simulation'

interface Props {
  steps: SequenceStep[]
  goals?: SequenceGoal[]
}

const EVENT_META: Record<SimEvent['kind'], { icon: string; tone: string }> = {
  'send-email': { icon: 'mail', tone: 'text-sky-300 border-sky-400/20 bg-sky-400/10' },
  'send-sms': { icon: 'sms', tone: 'text-teal-300 border-teal-400/20 bg-teal-400/10' },
  wait: { icon: 'hourglass_top', tone: 'text-amber-300 border-amber-400/20 bg-amber-400/10' },
  'wait-timeout': { icon: 'timer_off', tone: 'text-amber-300 border-amber-400/20 bg-amber-400/10' },
  branch: { icon: 'account_tree', tone: 'text-violet-300 border-violet-400/20 bg-violet-400/10' },
  'branch-exit': { icon: 'logout', tone: 'text-rose-300 border-rose-400/20 bg-rose-400/10' },
  'goal-exit': { icon: 'flag', tone: 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10' },
  completed: { icon: 'check_circle', tone: 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10' },
  'cycle-detected': { icon: 'sync_problem', tone: 'text-rose-300 border-rose-400/20 bg-rose-400/10' },
}

export default function EnrollmentPreview({ steps, goals }: Props) {
  const [scenario, setScenario] = useState<SimulationScenario>(emptyScenario())
  const [tagsInput, setTagsInput] = useState('')
  const [stageInput, setStageInput] = useState('')

  const effectiveScenario = useMemo<SimulationScenario>(
    () => ({
      ...scenario,
      tags: tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      stage: stageInput.trim(),
    }),
    [scenario, tagsInput, stageInput],
  )

  const result = useMemo(
    () => simulateEnrollment(steps, effectiveScenario, goals),
    [steps, effectiveScenario, goals],
  )

  function toggle(map: 'opened' | 'clicked' | 'replied' | 'waitSatisfied', step: number) {
    setScenario((prev) => ({
      ...prev,
      [map]: { ...prev[map], [step]: !prev[map][step] },
    }))
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Preview enrollment</h3>
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
          Toggle the signals a contact might give and see the exact path they would walk. Fully
          deterministic — no emails are sent.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Scenario controls */}
        <div className="bento-card !p-4 space-y-4">
          <div>
            <p className="eyebrow !text-[10px] mb-2">Contact attributes</p>
            <label className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Tags (comma-separated)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="vip, newsletter"
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
            />
            <label className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1 mt-3">Stage</label>
            <input
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              placeholder="customer"
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
            />
          </div>

          <div>
            <p className="eyebrow !text-[10px] mb-2">Per-step engagement</p>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div key={idx} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                  <p className="text-xs font-medium mb-2">
                    Step {idx + 1}: {step.subject?.trim() || (step.channel === 'sms' ? 'SMS' : 'Email')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['opened', 'clicked', 'replied'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggle(k, idx)}
                        className={[
                          'cursor-pointer rounded-full border px-2.5 py-1 text-[10px] capitalize transition-colors',
                          scenario[k][idx]
                            ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-text)]'
                            : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.03]',
                        ].join(' ')}
                      >
                        {k}
                      </button>
                    ))}
                    {step.waitUntil && (
                      <button
                        type="button"
                        onClick={() => toggle('waitSatisfied', idx)}
                        className={[
                          'cursor-pointer rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                          scenario.waitSatisfied[idx]
                            ? 'border-amber-400/40 bg-amber-400/15 text-amber-200'
                            : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.03]',
                        ].join(' ')}
                      >
                        wait met
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {steps.length === 0 && (
                <p className="text-xs text-[var(--color-pib-text-muted)]">Add steps to preview a path.</p>
              )}
            </div>
          </div>
        </div>

        {/* Simulated path */}
        <div className="bento-card !p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="eyebrow !text-[10px]">Simulated path</p>
            <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
              {result.events.length} event{result.events.length === 1 ? '' : 's'}
            </span>
          </div>
          <ol className="space-y-2">
            {result.events.map((ev, i) => {
              const meta = EVENT_META[ev.kind]
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${meta.tone}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{ev.label}</p>
                    {ev.detail && (
                      <p className="text-[11px] text-[var(--color-pib-text-muted)]">{ev.detail}</p>
                    )}
                    <p className="text-[10px] text-[var(--color-pib-text-muted)]">Day {ev.dayOffset}</p>
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="mt-4 rounded-lg border border-[var(--color-pib-line)] bg-black/10 px-3 py-2">
            <p className="text-[10px] text-[var(--color-pib-text-muted)] uppercase tracking-wide">Outcome</p>
            <p className="text-xs font-medium mt-0.5">{result.outcome}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
