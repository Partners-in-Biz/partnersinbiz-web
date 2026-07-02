'use client'

import { useMemo, useState } from 'react'
import {
  type CanvasModel,
  featuredModels,
  modelsForKind,
} from '@/lib/creative-canvas/model-registry'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export interface ModelPickerProps {
  kind: CanvasModel['kind']
  selectedModelId?: string
  onSelect: (modelId: string) => void
}

function matchesQuery(model: CanvasModel, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    model.label.toLowerCase().includes(q) ||
    model.family.toLowerCase().includes(q)
  )
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: CanvasModel
  selected: boolean
  onSelect: (modelId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      aria-pressed={selected}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: '10px',
        marginBottom: '4px',
        background: selected ? canvasTheme.surfaceRaised : canvasTheme.surface,
        color: canvasTheme.text,
        border: `1px solid ${selected ? canvasTheme.accent : canvasTheme.border}`,
        boxShadow: selected ? canvasTheme.accentGlow : 'none',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {selected && (
          <span aria-hidden style={{ color: canvasTheme.accent }}>
            ✓
          </span>
        )}
        <span>{model.label}</span>
        {model.maxReferenceImages === 1 && (
          <span
            title="Accepts a single reference image — multi-reference combines switch to Nano Banana automatically"
            style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '6px', border: `1px solid ${canvasTheme.border}`, color: canvasTheme.textMuted }}
          >
            1 ref
          </span>
        )}
      </span>
      <span style={{ color: canvasTheme.textMuted, fontSize: '12px' }}>
        ✦ {model.creditCost}
      </span>
    </button>
  )
}

export default function ModelPicker({
  kind,
  selectedModelId,
  onSelect,
}: ModelPickerProps) {
  const [query, setQuery] = useState('')

  const featured = useMemo(
    () =>
      featuredModels()
        .filter((m) => m.kind === kind)
        .filter((m) => matchesQuery(m, query)),
    [kind, query],
  )

  const groupedFamilies = useMemo(() => {
    const all = modelsForKind(kind).filter((m) => matchesQuery(m, query))
    const groups = new Map<string, CanvasModel[]>()
    for (const model of all) {
      const existing = groups.get(model.family)
      if (existing) {
        existing.push(model)
      } else {
        groups.set(model.family, [model])
      }
    }
    return Array.from(groups.entries())
  }, [kind, query])

  return (
    <div
      style={{
        background: canvasTheme.surface,
        border: `1px solid ${canvasTheme.border}`,
        borderRadius: canvasTheme.radius,
        padding: '12px',
        color: canvasTheme.text,
      }}
    >
      <input
        type="text"
        placeholder="Search models"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          marginBottom: '12px',
          background: canvasTheme.bg,
          color: canvasTheme.text,
          border: `1px solid ${canvasTheme.border}`,
          borderRadius: '10px',
          outline: 'none',
        }}
      />

      {featured.length > 0 && (
        <section style={{ marginBottom: '14px' }}>
          <h3
            style={{
              margin: '0 0 8px',
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: canvasTheme.textMuted,
            }}
          >
            Featured models
          </h3>
          {featured.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={selectedModelId === model.id}
              onSelect={onSelect}
            />
          ))}
        </section>
      )}

      {groupedFamilies.length > 0 && (
        <section>
          <h3
            style={{
              margin: '0 0 8px',
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: canvasTheme.textMuted,
            }}
          >
            All models
          </h3>
          {groupedFamilies.map(([family, models]) => (
            <div key={family} style={{ marginBottom: '10px' }}>
              <h4
                style={{
                  margin: '0 0 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: canvasTheme.textMuted,
                }}
              >
                {family}
              </h4>
              {models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selected={selectedModelId === model.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
