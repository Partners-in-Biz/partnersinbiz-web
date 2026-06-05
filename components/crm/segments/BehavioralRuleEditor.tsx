// components/crm/segments/BehavioralRuleEditor.tsx
'use client'

import { useEffect, useState } from 'react'
import type {
  BehavioralOp,
  BehavioralRule,
  BehavioralScope,
} from '@/lib/crm/segments'

const OPS: Array<{ value: BehavioralOp; label: string }> = [
  { value: 'has-opened', label: 'Has opened' },
  { value: 'has-not-opened', label: 'Has NOT opened' },
  { value: 'has-clicked', label: 'Has clicked' },
  { value: 'has-not-clicked', label: 'Has NOT clicked' },
  { value: 'has-received', label: 'Has received' },
  { value: 'has-not-received', label: 'Has NOT received' },
  { value: 'has-replied', label: 'Has replied' },
  { value: 'has-not-replied', label: 'Has NOT replied' },
]

const SCOPES: Array<{ value: BehavioralScope; label: string }> = [
  { value: 'any-email', label: 'Any email' },
  { value: 'broadcast', label: 'Specific broadcast' },
  { value: 'campaign', label: 'Specific campaign' },
  { value: 'sequence', label: 'Specific sequence' },
  { value: 'sequence-step', label: 'Specific sequence step' },
  { value: 'topic', label: 'Topic' },
  { value: 'link-url', label: 'Link URL contains' },
]

interface ScopeOption {
  id: string
  label: string
}

interface BehavioralRuleEditorProps {
  rules: BehavioralRule[]
  onChange: (rules: BehavioralRule[]) => void
  /** Hits the preview endpoint with the current filter state — set by parent. */
  liveCount?: number | null
  liveCountLoading?: boolean
}

export function BehavioralRuleEditor({
  rules,
  onChange,
  liveCount,
  liveCountLoading,
}: BehavioralRuleEditorProps) {
  function updateRule(idx: number, patch: Partial<BehavioralRule>) {
    const next = rules.slice()
    next[idx] = { ...next[idx], ...patch }
    // Drop scopeId when switching to a scope that doesn't use it.
    if (patch.scope) {
      if (patch.scope === 'any-email') {
        delete next[idx].scopeId
        delete next[idx].scopeStepNumber
      }
      if (patch.scope !== 'sequence-step') {
        delete next[idx].scopeStepNumber
      }
    }
    onChange(next)
  }

  function addRule() {
    onChange([
      ...rules,
      { op: 'has-opened', scope: 'any-email', withinDays: 30 },
    ])
  }

  function removeRule(idx: number) {
    const next = rules.slice()
    next.splice(idx, 1)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Behavioral rules</p>
          <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-1">
            Filter by email engagement. All rules combine with AND.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {liveCountLoading ? (
            <span className="text-[11px] font-mono text-[var(--color-pib-text-muted)]">
              counting…
            </span>
          ) : typeof liveCount === 'number' ? (
            <span className="pill">{liveCount} match{liveCount === 1 ? '' : 'es'}</span>
          ) : null}
          <button type="button" onClick={addRule} className="btn-pib-secondary !py-1.5 !px-3 !text-xs">
            <span className="material-symbols-outlined text-base">add</span>
            Add rule
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="text-[11px] text-[var(--color-pib-text-muted)] py-3 border border-dashed border-[var(--color-pib-line)] rounded text-center">
          No behavioral rules. Click <strong>Add rule</strong> to filter by email engagement.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, idx) => (
            <RuleRow
              key={idx}
              rule={rule}
              onChange={(patch) => updateRule(idx, patch)}
              onRemove={() => removeRule(idx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface RuleRowProps {
  rule: BehavioralRule
  onChange: (patch: Partial<BehavioralRule>) => void
  onRemove: () => void
}

function RuleRow({ rule, onChange, onRemove }: RuleRowProps) {
  const needsScopeId =
    rule.scope === 'broadcast' ||
    rule.scope === 'campaign' ||
    rule.scope === 'sequence' ||
    rule.scope === 'sequence-step' ||
    rule.scope === 'topic' ||
    rule.scope === 'link-url'

  const isReply = rule.op === 'has-replied' || rule.op === 'has-not-replied'

  return (
    <div className="border border-[var(--color-pib-line)] rounded p-3 space-y-2 bg-[var(--color-pib-surface,rgba(255,255,255,0.02))]">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <div className="md:col-span-3">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Action
          </label>
          <select
            value={rule.op}
            onChange={(e) => onChange({ op: e.target.value as BehavioralOp })}
            className="pib-input w-full"
          >
            {OPS.map((o) => (
              <option key={o.value} value={o.value} className="bg-black">
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Scope
          </label>
          <select
            value={rule.scope}
            onChange={(e) =>
              onChange({
                scope: e.target.value as BehavioralScope,
                scopeId: undefined,
              })
            }
            className="pib-input w-full"
          >
            {SCOPES.map((s) => (
              <option
                key={s.value}
                value={s.value}
                className="bg-black"
                disabled={
                  isReply &&
                  (s.value === 'topic' || s.value === 'link-url' || s.value === 'sequence-step')
                }
              >
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-4">
          {needsScopeId && (
            <ScopeIdInput
              scope={rule.scope}
              scopeId={rule.scopeId ?? ''}
              scopeStepNumber={rule.scopeStepNumber}
              onChange={(scopeId, scopeStepNumber) => onChange({ scopeId, scopeStepNumber })}
            />
          )}
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Within days
          </label>
          <input
            type="number"
            min={0}
            value={rule.withinDays ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange({ withinDays: Number.isFinite(n) && n > 0 ? n : undefined })
            }}
            placeholder="any time"
            className="pib-input w-full"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-danger,#FCA5A5)] transition-colors"
        >
          Remove rule
        </button>
      </div>
    </div>
  )
}

interface ScopeIdInputProps {
  scope: BehavioralScope
  scopeId: string
  scopeStepNumber?: number
  onChange: (scopeId: string, scopeStepNumber?: number) => void
}

function ScopeIdInput({ scope, scopeId, scopeStepNumber, onChange }: ScopeIdInputProps) {
  const [options, setOptions] = useState<ScopeOption[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (scope === 'topic' || scope === 'link-url') {
        setOptions(null) // free-text inputs
        return
      }
      const endpointByScope: Partial<Record<BehavioralScope, string>> = {
        broadcast: '/api/v1/broadcasts',
        campaign: '/api/v1/campaigns',
        sequence: '/api/v1/sequences',
        'sequence-step': '/api/v1/sequences',
      }
      const endpoint = endpointByScope[scope]
      if (!endpoint) {
        setOptions([])
        return
      }
      setLoading(true)
      try {
        const res = await fetch(endpoint)
        if (!res.ok) {
          if (!cancelled) setOptions([])
          return
        }
        const body = await res.json()
        const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
        if (cancelled) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setOptions(list.map((d: any) => ({ id: d.id, label: d.name || d.subject || d.id })))
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [scope])

  if (scope === 'topic') {
    return (
      <>
        <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
          Topic ID
        </label>
        <input
          value={scopeId}
          onChange={(e) => onChange(e.target.value)}
          placeholder="newsletter"
          className="pib-input w-full"
        />
      </>
    )
  }
  if (scope === 'link-url') {
    return (
      <>
        <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
          URL contains
        </label>
        <input
          value={scopeId}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/pricing"
          className="pib-input w-full"
        />
      </>
    )
  }
  if (scope === 'sequence-step') {
    return (
      <>
        <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
          Sequence + step #
        </label>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={scopeId}
            onChange={(e) => onChange(e.target.value, scopeStepNumber)}
            className="pib-input col-span-2"
            disabled={loading}
          >
            <option value="" className="bg-black">
              {loading ? 'Loading…' : 'Select sequence'}
            </option>
            {options?.map((o) => (
              <option key={o.id} value={o.id} className="bg-black">
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={scopeStepNumber ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(scopeId, Number.isFinite(n) ? n : undefined)
            }}
            placeholder="Step #"
            className="pib-input"
          />
        </div>
      </>
    )
  }

  // broadcast / campaign / sequence
  const labelMap: Partial<Record<BehavioralScope, string>> = {
    broadcast: 'Broadcast',
    campaign: 'Campaign',
    sequence: 'Sequence',
  }
  return (
    <>
      <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
        {labelMap[scope] ?? 'Scope'}
      </label>
      <select
        value={scopeId}
        onChange={(e) => onChange(e.target.value)}
        className="pib-input w-full"
        disabled={loading}
      >
        <option value="" className="bg-black">
          {loading ? 'Loading…' : `Select ${labelMap[scope]?.toLowerCase() ?? 'scope'}`}
        </option>
        {options?.map((o) => (
          <option key={o.id} value={o.id} className="bg-black">
            {o.label}
          </option>
        ))}
      </select>
    </>
  )
}
