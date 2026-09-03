'use client'

import { FiChevronDown, FiChevronUp, FiX } from 'react-icons/fi'
import { EDITOR_EFFECT_DEFS, EDITOR_EFFECT_KINDS, defaultEffectInstance } from '@/lib/video-editor/effects'
import type { EffectParamDef, EditorEffectKind } from '@/lib/video-editor/effects'
import type { EditorEffectInstance } from '@/lib/video-editor/types'

export interface EffectsSectionLut {
  id: string
  title: string
  url: string
}

function inputClass() {
  return 'mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm'
}

function ParamControl({
  def,
  value,
  luts,
  onChange,
}: {
  def: EffectParamDef
  value: string | number | boolean
  luts: EffectsSectionLut[]
  onChange: (next: string | number | boolean) => void
}) {
  if (def.type === 'number') {
    return (
      <label className="block text-xs text-[var(--color-pib-text-muted)]">
        {def.label}
        <input
          aria-label={def.label}
          className="mt-1 w-full"
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={typeof value === 'number' ? value : def.default}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="text-[10px]">{String(value)}</span>
      </label>
    )
  }

  if (def.type === 'color') {
    return (
      <label className="block text-xs text-[var(--color-pib-text-muted)]">
        {def.label}
        <input
          aria-label={def.label}
          className={inputClass()}
          type="color"
          value={typeof value === 'string' ? value : def.default}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }

  if (def.type === 'select') {
    return (
      <label className="block text-xs text-[var(--color-pib-text-muted)]">
        {def.label}
        <select aria-label={def.label} className={inputClass()} value={String(value ?? def.default)} onChange={(event) => onChange(event.target.value)}>
          {def.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    )
  }

  if (def.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
        <input aria-label={def.label} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        {def.label}
      </label>
    )
  }

  return (
    <label className="block text-xs text-[var(--color-pib-text-muted)]">
      {def.label}
      <select aria-label={def.label} className={inputClass()} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a LUT</option>
        {luts.map((lut) => <option key={lut.id} value={lut.url}>{lut.title}</option>)}
      </select>
    </label>
  )
}

export function EffectsSection({
  effects,
  luts,
  target,
  onChange,
}: {
  effects: EditorEffectInstance[]
  luts: EffectsSectionLut[]
  target?: 'video' | 'audio'
  onChange: (next: EditorEffectInstance[]) => void
}) {
  const availableKinds = EDITOR_EFFECT_KINDS.filter((kind) => !target || EDITOR_EFFECT_DEFS[kind].target === target)

  function patchEffect(index: number, key: string, value: string | number | boolean) {
    onChange(effects.map((effect, i) => (
      i === index ? { ...effect, params: { ...effect.params, [key]: value } } : effect
    )))
  }

  function moveEffect(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= effects.length) return
    const next = [...effects]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm text-[var(--color-pib-text)]">Effects</h3>
      <label className="block text-xs text-[var(--color-pib-text-muted)]">
        Add effect
        <select
          aria-label="Add effect"
          className={inputClass()}
          value=""
          onChange={(event) => {
            const kind = event.target.value as EditorEffectKind
            if (kind) onChange([...effects, defaultEffectInstance(kind)])
          }}
        >
          <option value="">Choose an effect</option>
          {availableKinds.map((kind) => <option key={kind} value={kind}>{EDITOR_EFFECT_DEFS[kind].label}</option>)}
        </select>
      </label>
      {effects.map((effect, index) => {
        const def = EDITOR_EFFECT_DEFS[effect.kind as EditorEffectKind]
        if (!def) return null
        return (
          <div key={`${effect.kind}-${index}`} className="rounded-lg border border-[var(--color-pib-line)] p-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium text-[var(--color-pib-text)]">{def.label}</span>
              <span className="flex gap-1">
                <button type="button" aria-label="Move effect up" className="pib-btn-ghost px-1 text-xs" onClick={() => moveEffect(index, -1)}>
                  <FiChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Move effect down" className="pib-btn-ghost px-1 text-xs" onClick={() => moveEffect(index, 1)}>
                  <FiChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Remove effect" className="pib-btn-ghost px-1 text-xs" onClick={() => onChange(effects.filter((_, i) => i !== index))}>
                  <FiX aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            <div className="mt-1 space-y-1">
              {def.params.map((paramDef) => (
                <ParamControl
                  key={paramDef.key}
                  def={paramDef}
                  luts={luts}
                  value={effect.params[paramDef.key] ?? paramDef.default}
                  onChange={(value) => patchEffect(index, paramDef.key, value)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
