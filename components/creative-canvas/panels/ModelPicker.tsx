'use client'

import { useMemo, useState } from 'react'
import {
  type CanvasModel,
  modelsForKind,
} from '@/lib/creative-canvas/model-registry'
import { getCreativeCanvasProvider } from '@/lib/creative-canvas/providers'
import type { CreativeCanvasProviderKey } from '@/lib/creative-canvas/types'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

/**
 * Providers assumed connected when the caller does not pass an explicit list.
 * `higgsfield` + `agent_task` are the platform-native lanes; `xai` has a
 * platform env fallback key so its models are usable without a BYOK connection.
 */
const DEFAULT_CONNECTED: CreativeCanvasProviderKey[] = ['higgsfield', 'agent_task', 'xai']

export interface ModelPickerProps {
  kind: CanvasModel['kind']
  selectedModelId?: string
  onSelect: (modelId: string) => void
  /** Provider keys the org has connected (plus platform-native lanes). */
  connectedProviders?: CreativeCanvasProviderKey[]
  /** Called when the user asks to connect an unconnected provider. */
  onConnectProvider?: (provider: CreativeCanvasProviderKey) => void
}

type ProviderFilter = 'all' | CreativeCanvasProviderKey

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
  showProvider,
  onSelect,
}: {
  model: CanvasModel
  selected: boolean
  showProvider: boolean
  onSelect: (modelId: string) => void
}) {
  const providerLabel = showProvider ? getCreativeCanvasProvider(model.providerKey)?.label : undefined
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
        {providerLabel && (
          <span style={{ fontSize: '10px', color: canvasTheme.textMuted }}>{providerLabel}</span>
        )}
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
  connectedProviders,
  onConnectProvider,
}: ModelPickerProps) {
  const [query, setQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')

  const connectedSet = useMemo(
    () => new Set(connectedProviders ?? DEFAULT_CONNECTED),
    [connectedProviders],
  )

  // Providers that ship at least one model of this kind — the chip row.
  const kindProviders = useMemo(() => {
    const seen: CreativeCanvasProviderKey[] = []
    for (const model of modelsForKind(kind)) {
      if (!seen.includes(model.providerKey)) seen.push(model.providerKey)
    }
    return seen
  }, [kind])

  const models = useMemo(() => {
    return modelsForKind(kind)
      .filter((m) => matchesQuery(m, query))
      .filter((m) =>
        providerFilter === 'all'
          ? connectedSet.has(m.providerKey)
          : m.providerKey === providerFilter,
      )
  }, [kind, query, providerFilter, connectedSet])

  const groupedFamilies = useMemo(() => {
    const groups = new Map<string, CanvasModel[]>()
    for (const model of models) {
      const existing = groups.get(model.family)
      if (existing) existing.push(model)
      else groups.set(model.family, [model])
    }
    return Array.from(groups.entries())
  }, [models])

  const chipStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    border: `1px solid ${active ? canvasTheme.accent : canvasTheme.border}`,
    background: active ? `${canvasTheme.accent}1f` : canvasTheme.surface,
    color: active ? canvasTheme.accent : disabled ? canvasTheme.textMuted : canvasTheme.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  })

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setProviderFilter('all')}
          aria-pressed={providerFilter === 'all'}
          style={chipStyle(providerFilter === 'all', false)}
        >
          All
        </button>
        {kindProviders.map((key) => {
          const provider = getCreativeCanvasProvider(key)
          if (!provider) return null
          const connected = connectedSet.has(key)
          const active = providerFilter === key
          return (
            <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                disabled={!connected}
                onClick={() => connected && setProviderFilter(key)}
                aria-pressed={active}
                style={chipStyle(active, !connected)}
              >
                {provider.label}
              </button>
              {!connected && onConnectProvider && (
                <button
                  type="button"
                  onClick={() => onConnectProvider(key)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: canvasTheme.accent,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Connect {provider.label}
                </button>
              )}
            </span>
          )
        })}
      </div>

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
       aria-label="Search models"/>

      {groupedFamilies.length > 0 ? (
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
            {providerFilter === 'all' ? 'All models' : getCreativeCanvasProvider(providerFilter)?.label ?? 'Models'}
          </h3>
          {groupedFamilies.map(([family, familyModels]) => (
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
              {familyModels.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selected={selectedModelId === model.id}
                  showProvider={providerFilter === 'all'}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </section>
      ) : (
        <p style={{ fontSize: 12, color: canvasTheme.textMuted, margin: 0 }}>
          No models available for this provider.
        </p>
      )}
    </div>
  )
}
