'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/studio'

export interface MessageModelOption {
  id: string
  model: string
  displayName: string
  provider: string
  providerLabel: string
  configured: boolean
  active: boolean
  available: boolean
  connected?: boolean
  connectionId?: string
  connectionLabel?: string
  credentialBindingId?: string
  source: 'hermes' | 'agent-default' | 'connected'
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
  autoModel?: string
  autoProvider?: string
  autoLabel?: string
  runtimeSource?: 'live_config' | 'registry'
  models: MessageModelOption[]
  providers: Array<{ id: string; label: string; configured: boolean; active: boolean; connected?: boolean }>
  source: 'hermes' | 'agent-default' | 'none'
  warning?: string
  connectProvidersUrl?: string
  localOnlyProviderLabels?: string[]
  hermesConfiguredProviders?: string[]
  selectableModelCount?: number
  usageAdvisories?: Array<{
    provider: string
    phase: string
    chipLabel: string
    summary: string
    detail: string
  }>
}

export interface ModelRuntimeSelection {
  model: string
  provider?: string
  llmConnectionId: string
  llmCredentialBindingId: string
}

interface ModelProviderPickerProps {
  catalog: MessageModelCatalog | null
  loading?: boolean
  selected?: ModelRuntimeSelection | null
  selectedModel?: string
  selectedProvider?: string
  disabled?: boolean
  compact?: boolean
  placement?: 'top' | 'bottom'
  onSelect: (selection: ModelRuntimeSelection | null) => void
  onRefresh?: () => void
}

const PIN_STORAGE_KEY = 'pib.messages.pinnedModels.v1'

function modelKey(model: MessageModelOption): string {
  return `${model.connectionId || 'unbound'}:${model.provider}:${model.id}`
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
  placement = 'bottom',
  onSelect,
  onRefresh,
}: ModelProviderPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState<string[]>([])
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    setPinned(readPinned())
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setSheet(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  const models = catalog?.models ?? []
  const resolvedSelectedModel = selected?.model ?? selectedModel
  const resolvedSelectedProvider = selected?.provider ?? selectedProvider
  const resolvedConnectionId = selected?.llmConnectionId
  const activeModel = useMemo(() => {
    if (!resolvedSelectedModel) return undefined
    if (!models.length) return undefined
    return models.find((model) => model.id === resolvedSelectedModel
      && (!resolvedSelectedProvider || model.provider === resolvedSelectedProvider)
      && (!resolvedConnectionId || model.connectionId === resolvedConnectionId))
  }, [models, resolvedSelectedModel, resolvedSelectedProvider, resolvedConnectionId])

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
    const groups: Array<{ key: string; provider: string; providerLabel: string; models: MessageModelOption[] }> = []
    const byProvider = new Map<string, { key: string; provider: string; providerLabel: string; models: MessageModelOption[] }>()
    for (const model of filteredModels) {
      const key = `${model.connectionId || 'unbound'}:${model.provider}`
      let group = byProvider.get(key)
      if (!group) {
        group = { key, provider: model.provider, providerLabel: model.providerLabel, models: [] }
        byProvider.set(key, group)
        groups.push(group)
      }
      group.models.push(model)
    }
    return groups
  }, [filteredModels])

  const canSelect = Boolean(catalog?.canSelect) && !disabled
  const autoSubtitle = catalog?.autoLabel
    || (catalog?.autoProvider && catalog?.autoModel ? `${catalog.autoProvider} · ${catalog.autoModel}` : null)
    || (catalog?.currentProvider && catalog?.currentModel ? `${catalog.currentProvider} · ${catalog.currentModel}` : null)
  const activeLabel = loading
    ? 'Loading models…'
    : activeModel
      ? `${activeModel.providerLabel} · ${activeModel.displayName}`
      : autoSubtitle
        ? `Auto · ${(catalog?.autoModel || catalog?.currentModel || '').split('/').pop()}`
        : labelForModel(resolvedSelectedModel, resolvedSelectedProvider)
  const availableCount = catalog?.selectableModelCount
    ?? models.filter((model) => model.available).length
  const catalogCountLabel = catalog?.source === 'agent-default'
    ? 'Using agent default fallback'
    : `${availableCount} selectable · ${models.length} listed`

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
          'inline-flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-row-hover)] text-[var(--color-pib-text)] transition-colors hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-45',
          compact ? 'h-8 max-w-[min(100%,18rem)] px-2.5 text-[12px]' : 'h-8 px-2.5 text-xs',
        ].join(' ')}
      >
        <Icon name="memory" className="text-[15px]" />
        <span className={compact ? 'max-w-[min(14rem,calc(100vw-8rem))] truncate' : 'max-w-[160px] truncate'}>{activeLabel}</span>
        {catalog?.canSelect === false && <Icon name="lock" className="text-[13px]" />}
        <Icon name="expand_more" className="text-[14px]" />
      </button>

      {open && (
        <>
          {sheet ? (
            <button
              type="button"
              aria-label="Dismiss model picker"
              className="fixed inset-0 z-[90] bg-[var(--color-pib-surface)]"
              onClick={() => setOpen(false)}
            />
          ) : null}
          <div
            role="dialog"
            aria-label="Choose model and provider"
            data-presentation={sheet ? 'sheet' : 'popover'}
            className={
              sheet
                ? 'fixed inset-x-0 bottom-0 z-[91] flex max-h-[min(34rem,80dvh)] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] pb-[env(safe-area-inset-bottom)] '
                : [
                    'absolute right-0 z-40 flex max-h-[min(560px,calc(100dvh-5rem))] w-[min(360px,calc(100vw-1rem))] flex-col overflow-hidden rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] ',
                    placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
                  ].join(' ')
            }
          >
          <div className="shrink-0 border-b border-[var(--color-card-border)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[var(--color-pib-text)]">Model & provider</div>
                <div className="text-[11px] text-[var(--color-pib-text-muted)]">
                  {catalogCountLabel}
                </div>
              </div>
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                  aria-label="Refresh models"
                >
                  <Icon name="refresh" className="text-[16px]" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                aria-label="Close model picker"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models or providers"
              aria-label="Search models or providers"
              className="mt-3 h-9 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] outline-none focus:border-primary/60"
            />
            {catalog?.warning && (
              <div className="mt-2 rounded-lg border border-amber-400/25 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--st-warning)]">
                {catalog.warning}
              </div>
            )}
            {catalog?.usageAdvisories?.map((advisory) => (
              <div
                key={`${advisory.provider}-${advisory.phase}`}
                data-testid={`model-provider-usage-${advisory.provider}`}
                title={advisory.detail}
                className={`mt-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                  advisory.phase === 'peak'
                    ? 'border-amber-400/25 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)]'
                    : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                <span className="font-medium">{advisory.chipLabel}</span>
                {' · '}
                {advisory.summary}
              </div>
            ))}
          </div>

          <div data-testid="model-provider-options" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            <button
              type="button"
              disabled={!canSelect}
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="auto_awesome" className="text-[15px]" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Auto model</span>
                <span className="block truncate text-[10px] text-[var(--color-pib-text-muted)]">
                  {autoSubtitle
                    ? `Uses live runtime ${autoSubtitle}`
                    : 'Use the agent runtime default without a per-run override'}
                </span>
              </span>
              {!activeModel && (
                <Icon name="check" className="text-[16px] text-primary" label="Selected model" />
              )}
            </button>
            {filteredModels.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-[var(--color-pib-text-muted)]">No matching models</div>
            )}
            {groupedModels.map((group) => (
              <section key={group.key} className="py-1">
                <div className="px-2 pb-1 pib-label">
                  {group.providerLabel}
                </div>
                <div className="space-y-0.5">
                  {group.models.map((model) => {
                    const key = modelKey(model)
                    const selected = activeModel?.id === model.id && activeModel?.provider === model.provider
                    const isPinned = pinned.includes(key)
                    return (
                      <div key={key} className="group/model flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-[var(--color-pib-surface-muted)]">
                        <button
                          type="button"
                          onClick={() => togglePin(model)}
                          className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                          aria-label={isPinned ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
                        >
                          <Icon name={isPinned ? 'star' : 'star_outline'} className="text-[15px]" />
                        </button>
                        <button
                          type="button"
                          disabled={!canSelect || !model.available}
                          onClick={() => {
                            if (!model.connectionId || !model.credentialBindingId) return
                            onSelect({
                              model: model.id,
                              provider: model.provider,
                              llmConnectionId: model.connectionId,
                              llmCredentialBindingId: model.credentialBindingId,
                            })
                            setOpen(false)
                          }}
                          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-medium text-[var(--color-pib-text)]">{model.displayName}</span>
                            {model.active && model.available && (
                              <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">Auto default</span>
                            )}
                            {model.connected && (
                              <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-200">Connected</span>
                            )}
                            {!model.available && (
                              <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-200">Needs credentials</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--color-pib-text-muted)]">
                            <span className="truncate font-mono">{model.id}</span>
                          </div>
                          {model.reasonUnavailable && (
                            <div className="mt-0.5 text-[10px] text-red-200">{model.reasonUnavailable}</div>
                          )}
                        </button>
                        {selected && (
                          <Icon name="check" className="pr-1 text-[16px] text-primary" label="Selected model" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-card-border)] px-3 py-2 text-[11px]">
            <button
              type="button"
              onClick={onRefresh}
              disabled={!onRefresh}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] disabled:opacity-40"
            >
              <Icon name="refresh" className="text-[14px]" />
              Refresh Models
            </button>
            <a
              href={catalog?.connectProvidersUrl || '/portal/settings/llm-providers'}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
            >
              <Icon name="tune" className="text-[14px]" />
              Connect providers…
            </a>
          </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ModelProviderPicker
