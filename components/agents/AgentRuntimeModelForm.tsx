'use client'

import { useEffect, useState } from 'react'
import {
  COMMON_RUNTIME_PROVIDERS,
  RUNTIME_EFFORT_OPTIONS,
  type AgentRuntimeModelSettings,
  type RuntimeFallbackEntry,
} from '@/lib/agents/runtime-config'

type Props = {
  agentId: string
  canEdit: boolean
  /** Live config payload from GET /config (body.data), used to seed the form. */
  liveConfigSource: unknown
  onSaved?: (result: {
    settings: AgentRuntimeModelSettings
    registryDefaultModel?: string | null
    agent?: unknown
  }) => void
}

const emptyFallback = (): RuntimeFallbackEntry => ({ provider: '', model: '' })

function seedFromLive(liveConfigSource: unknown): AgentRuntimeModelSettings {
  const root = liveConfigSource && typeof liveConfigSource === 'object'
    ? liveConfigSource as Record<string, unknown>
    : null
  const liveConfig = root?.liveConfig ?? liveConfigSource
  const liveObj = liveConfig && typeof liveConfig === 'object' ? liveConfig as Record<string, unknown> : null
  const config = liveObj && 'config' in liveObj && liveObj.config && typeof liveObj.config === 'object'
    ? liveObj.config as Record<string, unknown>
    : liveObj

  const model = config?.model && typeof config.model === 'object' && !Array.isArray(config.model)
    ? config.model as Record<string, unknown>
    : null
  const agent = config?.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)
    ? config.agent as Record<string, unknown>
    : null

  const primaryProvider = typeof model?.provider === 'string' ? model.provider : ''
  const primaryModel = typeof model?.default === 'string'
    ? model.default
    : typeof model?.model === 'string'
      ? model.model
      : ''
  const primaryBaseUrl = typeof model?.base_url === 'string'
    ? model.base_url
    : typeof model?.baseUrl === 'string'
      ? model.baseUrl
      : ''
  const reasoningEffort = typeof agent?.reasoning_effort === 'string'
    ? agent.reasoning_effort
    : typeof agent?.reasoningEffort === 'string'
      ? agent.reasoningEffort
      : ''

  const rawFallbacks = Array.isArray(config?.fallback_providers)
    ? config!.fallback_providers
    : Array.isArray(config?.fallbackProviders)
      ? config!.fallbackProviders
      : []

  const fallbacks: RuntimeFallbackEntry[] = rawFallbacks
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const rec = entry as Record<string, unknown>
      const provider = typeof rec.provider === 'string' ? rec.provider.trim() : ''
      const modelName = typeof rec.model === 'string'
        ? rec.model.trim()
        : typeof rec.default === 'string'
          ? rec.default.trim()
          : ''
      if (!provider && !modelName) return null
      return { provider, model: modelName }
    })
    .filter((entry): entry is RuntimeFallbackEntry => Boolean(entry))

  return {
    primaryProvider,
    primaryModel,
    primaryBaseUrl,
    reasoningEffort,
    fallbacks: fallbacks.length > 0 ? fallbacks : [],
  }
}

export function AgentRuntimeModelForm({ agentId, canEdit, liveConfigSource, onSaved }: Props) {
  const [primaryProvider, setPrimaryProvider] = useState('')
  const [primaryModel, setPrimaryModel] = useState('')
  const [primaryBaseUrl, setPrimaryBaseUrl] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')
  const [fallbacks, setFallbacks] = useState<RuntimeFallbackEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const seeded = seedFromLive(liveConfigSource)
    setPrimaryProvider(seeded.primaryProvider)
    setPrimaryModel(seeded.primaryModel)
    setPrimaryBaseUrl(seeded.primaryBaseUrl)
    setReasoningEffort(seeded.reasoningEffort)
    setFallbacks(seeded.fallbacks)
    setError(null)
    setMessage(null)
  }, [agentId, liveConfigSource])

  function updateFallback(index: number, patch: Partial<RuntimeFallbackEntry>) {
    setFallbacks((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeFallback(index: number) {
    setFallbacks((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const cleanedFallbacks = fallbacks
        .map((row) => ({ provider: row.provider.trim(), model: row.model.trim() }))
        .filter((row) => row.provider || row.model)

      for (const [index, row] of cleanedFallbacks.entries()) {
        if (!row.provider || !row.model) {
          throw new Error(`Fallback ${index + 1} needs both provider and model (or clear the row)`)
        }
      }

      const res = await fetch(`/api/v1/admin/agents/${agentId}/runtime-model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryProvider: primaryProvider.trim(),
          primaryModel: primaryModel.trim(),
          primaryBaseUrl: primaryBaseUrl.trim(),
          reasoningEffort: reasoningEffort.trim(),
          fallbacks: cleanedFallbacks,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `Failed to save runtime model (${res.status})`)
      }

      const settings = body.data?.settings as AgentRuntimeModelSettings | undefined
      if (settings) {
        setPrimaryProvider(settings.primaryProvider)
        setPrimaryModel(settings.primaryModel)
        setPrimaryBaseUrl(settings.primaryBaseUrl)
        setReasoningEffort(settings.reasoningEffort)
        setFallbacks(settings.fallbacks)
      }

      const registryNote = body.data?.registrySyncError
        ? ` Live config saved; registry sync failed: ${body.data.registrySyncError}`
        : ''
      setMessage(`Auto model saved. Gateway is restarting…${registryNote}`)
      onSaved?.({
        settings: settings ?? {
          primaryProvider: primaryProvider.trim(),
          primaryModel: primaryModel.trim(),
          primaryBaseUrl: primaryBaseUrl.trim(),
          reasoningEffort: reasoningEffort.trim(),
          fallbacks: cleanedFallbacks,
        },
        registryDefaultModel: body.data?.registryDefaultModel ?? null,
        agent: body.data?.agent,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save runtime model')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pib-card space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] pib-label">Auto model & effort</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
            This is what Messages uses when the picker is on <strong className="text-[var(--color-pib-text)]">Auto</strong>.
            Writes the live Hermes profile (not only the registry label). Fallbacks run when the primary fails.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`runtime-primary-provider-${agentId}`} className="flex flex-col gap-1">
          <span className="text-[10px] pib-label">Primary provider</span>
          <input
            id={`runtime-primary-provider-${agentId}`}
            list={`runtime-providers-${agentId}`}
            value={primaryProvider}
            onChange={(e) => setPrimaryProvider(e.target.value)}
            disabled={!canEdit || saving}
            required
            className="pib-input w-full font-mono text-sm"
            placeholder="xai-oauth"
            aria-label="Primary provider"
          />
          <datalist id={`runtime-providers-${agentId}`}>
            {COMMON_RUNTIME_PROVIDERS.map((provider) => (
              <option key={provider} value={provider} />
            ))}
          </datalist>
        </label>

        <label htmlFor={`runtime-primary-model-${agentId}`} className="flex flex-col gap-1">
          <span className="text-[10px] pib-label">Primary model</span>
          <input
            id={`runtime-primary-model-${agentId}`}
            value={primaryModel}
            onChange={(e) => setPrimaryModel(e.target.value)}
            disabled={!canEdit || saving}
            required
            className="pib-input w-full font-mono text-sm"
            placeholder="grok-4.6"
            aria-label="Primary model"
          />
        </label>

        <label htmlFor={`runtime-primary-base-url-${agentId}`} className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[10px] pib-label">Primary base URL (optional)</span>
          <input
            id={`runtime-primary-base-url-${agentId}`}
            value={primaryBaseUrl}
            onChange={(e) => setPrimaryBaseUrl(e.target.value)}
            disabled={!canEdit || saving}
            className="pib-input w-full font-mono text-sm"
            placeholder="https://api.x.ai/v1"
            aria-label="Primary base URL"
          />
        </label>

        <label htmlFor={`runtime-reasoning-effort-${agentId}`} className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[10px] pib-label">Default reasoning effort</span>
          <select
            id={`runtime-reasoning-effort-${agentId}`}
            value={reasoningEffort}
            onChange={(e) => setReasoningEffort(e.target.value)}
            disabled={!canEdit || saving}
            className="pib-input w-full text-sm"
            aria-label="Default reasoning effort"
          >
            {RUNTIME_EFFORT_OPTIONS.map((option) => (
              <option key={option.value || 'unset'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-[var(--color-pib-text-muted)]/70">
            Standing default for this agent. Per-message / per-task effort can still override a single run.
          </span>
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] pib-label">Fallback providers</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setFallbacks((prev) => [...prev, emptyFallback()])}
              disabled={saving}
              className="pib-btn-ghost text-xs font-label disabled:opacity-50"
            >
              Add fallback
            </button>
          )}
        </div>

        {fallbacks.length === 0 ? (
          <p className="text-xs text-[var(--color-pib-text-muted)]">No fallbacks configured.</p>
        ) : (
          <div className="space-y-2">
            {fallbacks.map((row, index) => (
              <div
                key={`fallback-${index}`}
                className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
              >
                <input
                  id={`runtime-fallback-provider-${agentId}-${index}`}
                  list={`runtime-providers-${agentId}-fb-${index}`}
                  value={row.provider}
                  onChange={(e) => updateFallback(index, { provider: e.target.value })}
                  disabled={!canEdit || saving}
                  className="pib-input w-full font-mono text-sm"
                  placeholder="Provider (e.g. nous)"
                  aria-label={`Fallback ${index + 1} provider`}
                />
                <datalist id={`runtime-providers-${agentId}-fb-${index}`}>
                  {COMMON_RUNTIME_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider} />
                  ))}
                </datalist>
                <input
                  id={`runtime-fallback-model-${agentId}-${index}`}
                  value={row.model}
                  onChange={(e) => updateFallback(index, { model: e.target.value })}
                  disabled={!canEdit || saving}
                  className="pib-input w-full font-mono text-sm"
                  placeholder="Model (e.g. deepseek/deepseek-v4-flash)"
                  aria-label={`Fallback ${index + 1} model`}
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeFallback(index)}
                    disabled={saving}
                    className="pib-btn-ghost text-xs text-red-300 disabled:opacity-50"
                    title="Remove fallback"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{message}</div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !primaryProvider.trim() || !primaryModel.trim()}
            className="btn-pib-primary btn-pib-sm text-xs font-label disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Auto model'}
          </button>
        </div>
      )}

      {!canEdit && (
        <p className="text-[10px] text-[var(--color-pib-text-muted)]/70">
          Only super admins can change live Auto model, effort, and fallbacks.
        </p>
      )}
    </form>
  )
}
