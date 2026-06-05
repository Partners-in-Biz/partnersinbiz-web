// components/email/AbTestingPanel.tsx
//
// Reusable A/B testing editor panel. Drops into BroadcastEditor and the
// SequenceStepEditor — both take an AbConfig value/onChange pair.
//
// What it does:
//   - toggle A/B on/off
//   - pick mode (split / winner-only)
//   - manage variants (add, remove, edit label, edit weight, edit overrides)
//   - winner-only knobs (cohort %, duration, metric, autoPromote)
//   - when status is 'testing' / 'winner-pending' / 'winner-sent' / 'complete',
//     show live stats per variant and offer a "Declare winner" action
'use client'

import { useMemo } from 'react'
import type {
  AbConfig,
  AbMode,
  AbWinnerMetric,
  Variant,
  VariantOverride,
} from '@/lib/ab-testing/types'
import { EMPTY_AB, makeVariant } from '@/lib/ab-testing/types'

interface Props {
  value: AbConfig
  onChange: (next: AbConfig) => void
  disabled?: boolean
  /**
   * Optional callback for the "Declare winner manually" action. When omitted
   * the button is hidden. Receives the variant id the user clicked.
   */
  onDeclareWinner?: (variantId: string) => void | Promise<void>
}

const NEXT_LETTER = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

function nextVariantId(existing: Variant[]): string {
  const used = new Set(existing.map((v) => v.id))
  for (const ltr of NEXT_LETTER) if (!used.has(ltr)) return ltr
  // Fall through — z, aa, ab… (rare; cap is fine).
  return `v${existing.length + 1}`
}

function rebalanceWeights(variants: Variant[]): Variant[] {
  if (variants.length === 0) return variants
  const even = Math.floor(100 / variants.length)
  const remainder = 100 - even * variants.length
  return variants.map((v, i) => ({ ...v, weight: i === 0 ? even + remainder : even }))
}

export default function AbTestingPanel({ value, onChange, disabled, onDeclareWinner }: Props) {
  const ab = value ?? EMPTY_AB
  const isLocked = disabled || (ab.status !== 'inactive' && ab.status !== 'complete')

  const weightSum = useMemo(
    () => ab.variants.reduce((acc, v) => acc + (v.weight ?? 0), 0),
    [ab.variants],
  )

  function patch(next: Partial<AbConfig>) {
    onChange({ ...ab, ...next })
  }

  function setVariants(variants: Variant[]) {
    patch({ variants })
  }

  function addVariant() {
    const id = nextVariantId(ab.variants)
    const newV = makeVariant(id, `Variant ${id.toUpperCase()}`, 0)
    setVariants(rebalanceWeights([...ab.variants, newV]))
  }

  function removeVariant(id: string) {
    setVariants(rebalanceWeights(ab.variants.filter((v) => v.id !== id)))
  }

  function updateVariant(id: string, patch: Partial<Variant>) {
    setVariants(ab.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }

  function setOverride(id: string, idx: number, override: VariantOverride) {
    const variant = ab.variants.find((v) => v.id === id)
    if (!variant) return
    const overrides = variant.overrides.slice()
    overrides[idx] = override
    updateVariant(id, { overrides })
  }

  function addOverride(id: string, kind: VariantOverride['kind']) {
    const variant = ab.variants.find((v) => v.id === id)
    if (!variant) return
    let blank: VariantOverride
    if (kind === 'subject') blank = { kind, subject: '' }
    else if (kind === 'fromName') blank = { kind, fromName: '' }
    else if (kind === 'body') blank = { kind, bodyHtml: '', bodyText: '', subject: '' }
    else blank = { kind, offsetMinutes: 0 }
    updateVariant(id, { overrides: [...variant.overrides, blank] })
  }

  function removeOverride(id: string, idx: number) {
    const variant = ab.variants.find((v) => v.id === id)
    if (!variant) return
    updateVariant(id, { overrides: variant.overrides.filter((_, i) => i !== idx) })
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-4 text-on-surface">
      {/* Header ── enable toggle ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-amber-300">A/B Testing</h3>
          <p className="text-xs text-on-surface-variant">
            Test variants of subject, body, from-name, or send time.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="text-xs uppercase tracking-wide text-on-surface-variant">
            {ab.enabled ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={ab.enabled}
            disabled={disabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 accent-amber-500"
          />
        </label>
      </div>

      {ab.enabled && (
        <>
          {/* Mode ──────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-on-surface-variant mb-1">Mode</span>
              <select
                value={ab.mode}
                disabled={isLocked}
                onChange={(e) => patch({ mode: e.target.value as AbMode })}
                className="w-full rounded-md bg-black/50 border border-white/10 px-3 py-2 text-sm"
              >
                <option value="split">Split (every variant sent)</option>
                <option value="winner-only">Winner-only (test then fan out)</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs text-on-surface-variant mb-1">Winner Metric</span>
              <select
                value={ab.winnerMetric}
                disabled={isLocked}
                onChange={(e) => patch({ winnerMetric: e.target.value as AbWinnerMetric })}
                className="w-full rounded-md bg-black/50 border border-white/10 px-3 py-2 text-sm"
              >
                <option value="opens">Opens (count)</option>
                <option value="clicks">Clicks (count)</option>
                <option value="open-rate">Open rate</option>
                <option value="click-through-rate">Click-through rate</option>
              </select>
            </label>
          </div>

          {/* Winner-only knobs ─────────────────────────────────────────── */}
          {ab.mode === 'winner-only' && (
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-white/5 p-3">
              <label className="block">
                <span className="block text-xs text-on-surface-variant mb-1">
                  Test cohort {ab.testCohortPercent}%
                </span>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={ab.testCohortPercent}
                  disabled={isLocked}
                  onChange={(e) => patch({ testCohortPercent: parseInt(e.target.value) })}
                  className="w-full accent-amber-500"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-on-surface-variant mb-1">
                  Test duration (minutes)
                </span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={ab.testDurationMinutes}
                  disabled={isLocked}
                  onChange={(e) => patch({ testDurationMinutes: parseInt(e.target.value) || 0 })}
                  className="w-full rounded-md bg-black/50 border border-white/10 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={ab.autoPromote}
                  disabled={isLocked}
                  onChange={(e) => patch({ autoPromote: e.target.checked })}
                  className="h-4 w-4 accent-amber-500"
                />
                <span className="text-xs">Auto-promote winner</span>
              </label>
            </div>
          )}

          {/* Variants ──────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Variants</h4>
              <div className="flex items-center gap-3">
                {ab.mode === 'split' && (
                  <span
                    className={`text-xs ${
                      weightSum === 100 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    Weights total: {weightSum}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={addVariant}
                  disabled={isLocked || ab.variants.length >= NEXT_LETTER.length}
                  className="px-3 py-1.5 rounded-md bg-amber-500/20 text-amber-200 text-xs hover:bg-amber-500/30 disabled:opacity-40"
                >
                  + Add variant
                </button>
              </div>
            </div>

            {ab.variants.length === 0 && (
              <p className="text-xs text-on-surface-variant italic">
                Add at least 2 variants to start testing.
              </p>
            )}

            {ab.variants.map((v) => (
              <VariantRow
                key={v.id}
                variant={v}
                isWinner={ab.winnerVariantId === v.id}
                lockEdits={isLocked}
                showWinnerAction={!!onDeclareWinner && ab.status === 'testing'}
                onUpdate={(patch) => updateVariant(v.id, patch)}
                onRemove={() => removeVariant(v.id)}
                onSetOverride={(idx, o) => setOverride(v.id, idx, o)}
                onAddOverride={(kind) => addOverride(v.id, kind)}
                onRemoveOverride={(idx) => removeOverride(v.id, idx)}
                onDeclareWinner={() => onDeclareWinner?.(v.id)}
                splitMode={ab.mode === 'split'}
              />
            ))}
          </div>

          {/* Status banner ─────────────────────────────────────────────── */}
          {ab.status !== 'inactive' && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Status: <span className="font-mono">{ab.status}</span>
              {ab.winnerVariantId && (
                <> · Winner: <span className="font-mono">{ab.winnerVariantId}</span></>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Per-variant row ─────────────────────────────────────────────────────────

interface VariantRowProps {
  variant: Variant
  isWinner: boolean
  lockEdits: boolean
  showWinnerAction: boolean
  splitMode: boolean
  onUpdate: (patch: Partial<Variant>) => void
  onRemove: () => void
  onSetOverride: (idx: number, o: VariantOverride) => void
  onAddOverride: (kind: VariantOverride['kind']) => void
  onRemoveOverride: (idx: number) => void
  onDeclareWinner: () => void
}

function VariantRow(props: VariantRowProps) {
  const { variant, isWinner, lockEdits, splitMode, showWinnerAction } = props
  const openRate =
    variant.sent > 0 ? `${((variant.opened / variant.sent) * 100).toFixed(1)}%` : '—'
  const ctr =
    variant.opened > 0 ? `${((variant.clicked / variant.opened) * 100).toFixed(1)}%` : '—'

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        isWinner ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-white/10 bg-white/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex-none mt-2 inline-flex items-center justify-center h-8 w-8 rounded-full bg-amber-500/20 text-amber-200 font-mono text-sm">
          {variant.id.toUpperCase()}
        </span>
        <div className="flex-1 grid grid-cols-3 gap-2">
          <input
            value={variant.label}
            disabled={lockEdits}
            onChange={(e) => props.onUpdate({ label: e.target.value })}
            placeholder="Label"
            className="col-span-2 rounded-md bg-black/50 border border-white/10 px-3 py-2 text-sm"
          />
          {splitMode && (
            <label className="block">
              <input
                type="number"
                min={0}
                max={100}
                value={variant.weight}
                disabled={lockEdits}
                onChange={(e) => props.onUpdate({ weight: parseInt(e.target.value) || 0 })}
                className="w-full rounded-md bg-black/50 border border-white/10 px-3 py-2 text-sm"
              />
            </label>
          )}
        </div>
        <button
          type="button"
          onClick={props.onRemove}
          disabled={lockEdits}
          className="text-red-300 text-xs hover:underline disabled:opacity-40"
        >
          Remove
        </button>
      </div>

      {/* Overrides ─────────────────────────────────────────────────────── */}
      <div className="ml-11 space-y-2">
        {variant.overrides.map((o, idx) => (
          <OverrideEditor
            key={idx}
            override={o}
            disabled={lockEdits}
            onChange={(next) => props.onSetOverride(idx, next)}
            onRemove={() => props.onRemoveOverride(idx)}
          />
        ))}
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            disabled={lockEdits}
            onClick={() => props.onAddOverride('subject')}
            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40"
          >
            + Subject
          </button>
          <button
            type="button"
            disabled={lockEdits}
            onClick={() => props.onAddOverride('fromName')}
            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40"
          >
            + From name
          </button>
          <button
            type="button"
            disabled={lockEdits}
            onClick={() => props.onAddOverride('body')}
            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40"
          >
            + Body
          </button>
          <button
            type="button"
            disabled={lockEdits}
            onClick={() => props.onAddOverride('sendTime')}
            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40"
          >
            + Send time
          </button>
        </div>
      </div>

      {/* Stats ─────────────────────────────────────────────────────────── */}
      <div className="ml-11 mt-2 grid grid-cols-6 gap-2 text-xs text-on-surface-variant">
        <Stat label="Sent" value={variant.sent} />
        <Stat label="Delivered" value={variant.delivered} />
        <Stat label="Opened" value={variant.opened} sub={openRate} />
        <Stat label="Clicked" value={variant.clicked} sub={ctr} />
        <Stat label="Bounced" value={variant.bounced} />
        <Stat label="Unsub" value={variant.unsubscribed} />
      </div>

      {showWinnerAction && (
        <div className="ml-11">
          <button
            type="button"
            onClick={props.onDeclareWinner}
            className="px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-200 text-xs hover:bg-emerald-500/30"
          >
            Declare {variant.id.toUpperCase()} the winner
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded bg-black/30 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-on-surface-variant">{label}</div>
      <div className="text-sm font-mono">{value}</div>
      {sub && <div className="text-[10px] text-amber-300">{sub}</div>}
    </div>
  )
}

// ── Override editor ─────────────────────────────────────────────────────────

interface OverrideProps {
  override: VariantOverride
  disabled: boolean
  onChange: (next: VariantOverride) => void
  onRemove: () => void
}

function OverrideEditor({ override, disabled, onChange, onRemove }: OverrideProps) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="uppercase tracking-wide text-amber-300 text-[10px]">{override.kind}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="text-red-300 hover:underline disabled:opacity-40"
        >
          remove
        </button>
      </div>
      {override.kind === 'subject' && (
        <input
          value={override.subject}
          disabled={disabled}
          onChange={(e) => onChange({ kind: 'subject', subject: e.target.value })}
          placeholder="Override subject line"
          className="w-full rounded bg-black/50 border border-white/10 px-2 py-1"
        />
      )}
      {override.kind === 'fromName' && (
        <input
          value={override.fromName}
          disabled={disabled}
          onChange={(e) => onChange({ kind: 'fromName', fromName: e.target.value })}
          placeholder="Override from-name"
          className="w-full rounded bg-black/50 border border-white/10 px-2 py-1"
        />
      )}
      {override.kind === 'sendTime' && (
        <div className="flex items-center gap-2">
          <span>Offset (minutes):</span>
          <input
            type="number"
            value={override.offsetMinutes}
            disabled={disabled}
            onChange={(e) =>
              onChange({ kind: 'sendTime', offsetMinutes: parseInt(e.target.value) || 0 })
            }
            className="w-24 rounded bg-black/50 border border-white/10 px-2 py-1"
          />
        </div>
      )}
      {override.kind === 'body' && (
        <div className="space-y-1">
          <input
            value={override.subject ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...override, kind: 'body', subject: e.target.value })
            }
            placeholder="Subject (optional — paired with body)"
            className="w-full rounded bg-black/50 border border-white/10 px-2 py-1"
          />
          <textarea
            value={override.bodyHtml}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...override, kind: 'body', bodyHtml: e.target.value })
            }
            placeholder="HTML body"
            rows={3}
            className="w-full rounded bg-black/50 border border-white/10 px-2 py-1 font-mono"
          />
          <textarea
            value={override.bodyText}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...override, kind: 'body', bodyText: e.target.value })
            }
            placeholder="Plain text body"
            rows={2}
            className="w-full rounded bg-black/50 border border-white/10 px-2 py-1 font-mono"
          />
        </div>
      )}
    </div>
  )
}
