'use client'

import { useEffect, useMemo, useState } from 'react'

export interface MessageModelOption {
  id: string
  model: string
  displayName: string
  provider: string
  providerLabel: string
  configured: boolean
  active: boolean
  available: boolean
  source: 'hermes' | 'agent-default'
  supportsThinking?: boolean
  supportsVision?: boolean
  supportsTools?: boolean
  reasonUnavailable?: string
}

export interface MessageModelCatalog {
  agentId: string | null
  canSelect: boolean
  currentModel?: string
  currentProvider?: string
  models: MessageModelOption[]
  providers: Array<{ id: string; label: string; configured: boolean; active: boolean }>
  source: 'hermes' | 'agent-default' | 'none'
  warning?: string
}

export interface ModelRuntimeSelection {
  model: string
  provider?: string
}

interface ModelProviderPickerProps {
  catalog: MessageModelCatalog | null
  loading?: boolean
  selected?: ModelRuntimeSelection | null
  selectedModel?: string
  selectedProvider?: string
  disabled?: boolean
  compact?: boolean
  onSelect: (selection: ModelRuntimeSelection | null) => void
  onRefresh?: () => void
}

const PIN_STORAGE_KEY = 'pib.messages.pinnedModels.v1'

function modelKey(model: MessageModelOption): string {
  return `${model.provider}:${model.id}`
}

function labelForModel(model?: string, provider?: string): string {
  if (!model) return 'Auto model'
  const leaf = model.split('/').pop() || model
  return provider ? `${provider} · ${leaf}` : leaf
}

function readPinned(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PIN_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function ModelProviderPicker({
  catalog,
  loading = false,
  selected,
  selectedModel,
  selectedProvider,
  disabled = false,
  compact = false,
  onSelect,
  onRefresh,
}: ModelProviderPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState<string[]>([])

  useEffect(() => {
    setPinned(readPinned())
  }, [])

  const models = catalog?.models ?? []
  const resolvedSelectedModel = selected?.model ?? selectedModel
  const resolvedSelectedProvider = selected?.provider ?? selectedProvider
  const activeModel = useMemo(() => {
    if (!models.length) return undefined
    return models.find((model) => model.id === resolvedSelectedModel && (!resolvedSelectedProvider || model.provider === resolvedSelectedProvider))
      ?? models.find((model) => model.active)
      ?? models[0]
  }, [models, resolvedSelectedModel, resolvedSelectedProvider])

  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const sorted = [...models].sort((a, b) => {
      const aPinned = pinned.includes(modelKey(a))
      const bPinned = pinned.includes(modelKey(b))
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      if (a.active !== b.active) return a.active ? -1 : 1
      return `${a.providerLabel} ${a.displayName}`.localeCompare(`${b.providerLabel} ${b.displayName}`)
    })
    if (!needle) return sorted
    return sorted.filter((model) =>
      model.id.toLowerCase().includes(needle)
      || model.displayName.toLowerCase().includes(needle)
      || model.providerLabel.toLowerCase().includes(needle)
      || model.provider.toLowerCase().includes(needle),
    )
  }, [models, pinned, query])

  const groupedModels = useMemo(() => {
    const groups: Array<{ provider: string; providerLabel: string; models: MessageModelOption[] }> = []
    const byProvider = new Map<string, { provider: string; providerLabel: string; models: MessageModelOption[] }>()
    for (const model of filteredModels) {
      const key = model.provider
      let group = byProvider.get(key)
      if (!group) {
        group = { provider: model.provider, providerLabel: model.providerLabel, models: [] }
        byProvider.set(key, group)
        groups.push(group)
      }
      group.models.push(model)
    }
    return groups
  }, [filteredModels])

  const canSelect = Boolean(catalog?.canSelect) && !disabled
  const activeLabel = loading
    ? 'Loading models…'
    : activeModel
      ? `${activeModel.providerLabel} · ${activeModel.displayName}`
      : labelForModel(resolvedSelectedModel ?? catalog?.currentModel, resolvedSelectedProvider ?? catalog?.currentProvider)

  function togglePin(model: MessageModelOption) {
    const key = modelKey(model)
    const next = pinned.includes(key) ? pinned.filter((item) => item !== key) : [key, ...pinned]
    setPinned(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next.slice(0, 12)))
    }
  }

  return (
    <div className="relative inline-flex min-w-0">
      <button
        type="button"
        disabled={disabled || loading || models.length === 0 || catalog?.canSelect === false}
        onClick={() => setOpen((value) => !value)}
        title={catalog?.canSelect === false ? 'Model selection is visible but locked for this role' : 'Select model/provider'}
        aria-label={`Select model and provider: ${activeLabel}`}
        className={[
          'inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] text-on-surface-variant transition-colors hover:bg-white/[0.08] hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45',
          compact ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-xs',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[15px]">memory</span>
        <span className="max-w-[160px] truncate">{activeLabel}</span>
        {catalog?.canSelect === false && <span className="material-symbols-outlined text-[13px]">lock</span>}
        <span className="material-symbols-outlined text-[14px]">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] shadow-2xl">
          <div className="border-b border-[var(--color-card-border)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-on-surface">Model & provider</div>
                <div className="text-[11px] text-on-surface-variant">
                  {catalog?.source === 'agent-default' ? 'Using agent default fallback' : `${models.length} models available`}
                </div>
              </div>
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="grid h-7 w-7 place-items-center rounded-full text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface"
                  aria-label="Refresh models"
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-full text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface"
                aria-label="Close model picker"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models or providers"
              className="mt-3 h-9 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 text-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:border-primary/60"
            />
            {catalog?.warning && (
              <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                {catalog.warning}
              </div>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto p-1.5">
            {filteredModels.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-on-surface-variant">No matching models</div>
            )}
            {groupedModels.map((group) => (
              <section key={group.provider} className="py-1">
                <div className="px-2 pb-1 text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">
                  {group.providerLabel}
                </div>
                <div className="space-y-0.5">
                  {group.models.map((model) => {
                    const key = modelKey(model)
                    const selected = activeModel?.id === model.id && activeModel?.provider === model.provider
                    const isPinned = pinned.includes(key)
                    return (
                      <div key={key} className="group/model flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-white/[0.05]">
                        <button
                          type="button"
                          onClick={() => togglePin(model)}
                          className="grid h-7 w-7 place-items-center rounded-full text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface"
                          aria-label={isPinned ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
                        >
                          <span className="material-symbols-outlined text-[15px]">{isPinned ? 'star' : 'star_outline'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={!canSelect || !model.available}
                          onClick={() => {
                            onSelect({ model: model.id, provider: model.provider })
                            setOpen(false)
                          }}
                          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-medium text-on-surface">{model.displayName}</span>
                            {!model.available && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-200">Unavailable</span>}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-on-surface-variant">
                            <span className="truncate font-mono">{model.id}</span>
                          </div>
                          {model.reasonUnavailable && (
                            <div className="mt-0.5 text-[10px] text-red-200">{model.reasonUnavailable}</div>
                          )}
                        </button>
                        {selected && (
                          <span className="material-symbols-outlined pr-1 text-[16px] text-primary" aria-label="Selected model">
                            check
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-card-border)] px-3 py-2 text-[11px]">
            <button
              type="button"
              onClick={onRefresh}
              disabled={!onRefresh}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 font-medium text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              Refresh Models
            </button>
            <button
              type="button"
              disabled
              title="Model editing stays in the admin control plane"
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-on-surface-variant opacity-45"
            >
              <span className="material-symbols-outlined text-[14px]">tune</span>
              Edit Models…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ModelProviderPicker
