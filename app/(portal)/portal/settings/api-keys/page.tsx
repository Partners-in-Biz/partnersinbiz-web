// app/(portal)/portal/settings/api-keys/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopeFromSearchParams, scopedApiPath } from '@/lib/portal/scoped-routing'

type Resource = 'social' | 'projects' | 'tasks' | 'invoices' | 'pipeline' | 'platform'
type Action = 'read' | 'write' | 'delete'

interface Permission {
  resource: Resource
  actions: Action[]
}

interface FsTimestamp {
  _seconds?: number
  seconds?: number
}

interface ApiKeyRow {
  id: string
  name: string
  keyPrefix: string
  role: string
  permissions: Permission[]
  rateLimitPerMin: number | null
  usageLimit: number | null
  lastUsedAt: FsTimestamp | null
  expiresAt: FsTimestamp | string | null
  revokedAt: FsTimestamp | null
  createdAt: FsTimestamp | null
}

const RESOURCES: { value: Resource; label: string; icon: string }[] = [
  { value: 'social', label: 'Social', icon: 'share' },
  { value: 'projects', label: 'Projects', icon: 'folder' },
  { value: 'tasks', label: 'Tasks', icon: 'task_alt' },
  { value: 'invoices', label: 'Invoices', icon: 'receipt_long' },
  { value: 'pipeline', label: 'Pipeline', icon: 'filter_alt' },
  { value: 'platform', label: 'Platform', icon: 'tune' },
]

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'delete', label: 'Delete' },
]

function toMillis(ts: FsTimestamp | string | null | undefined): number | null {
  if (!ts) return null
  if (typeof ts === 'string') {
    const t = new Date(ts).getTime()
    return Number.isNaN(t) ? null : t
  }
  const s = ts._seconds ?? ts.seconds
  return typeof s === 'number' ? s * 1000 : null
}

function formatDate(ts: FsTimestamp | string | null | undefined): string {
  const ms = toMillis(ts)
  if (ms === null) return '—'
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function keyStatus(key: ApiKeyRow): { label: string; tone: 'success' | 'muted' | 'danger' } {
  if (key.revokedAt) return { label: 'Revoked', tone: 'danger' }
  const exp = toMillis(key.expiresAt)
  if (exp !== null && exp <= Date.now()) return { label: 'Expired', tone: 'danger' }
  return { label: 'Active', tone: 'success' }
}

export default function ApiKeysSettingsPage() {
  const searchParams = useSearchParams()
  const scope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [perms, setPerms] = useState<Record<Resource, Set<Action>>>(() => {
    const init = {} as Record<Resource, Set<Action>>
    RESOURCES.forEach((r) => (init[r.value] = new Set<Action>()))
    return init
  })
  const [expiresAt, setExpiresAt] = useState('')
  const [rateLimit, setRateLimit] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // The freshly created raw key (shown once)
  const [newKey, setNewKey] = useState<{ keyPrefix: string; rawKey: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [revokingId, setRevokingId] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(scopedApiPath('/api/v1/org/api-keys', scope), { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || body.success === false) {
        throw new Error(body.error || body.message || 'Failed to load keys')
      }
      setKeys((body.data ?? body) as ApiKeyRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  function toggleAction(resource: Resource, action: Action) {
    setPerms((prev) => {
      const next = { ...prev, [resource]: new Set(prev[resource]) }
      if (next[resource].has(action)) next[resource].delete(action)
      else next[resource].add(action)
      return next
    })
  }

  function buildPermissions(): Permission[] {
    return RESOURCES.flatMap((r) => {
      const actions = ACTIONS.map((a) => a.value).filter((a) => perms[r.value].has(a))
      return actions.length > 0 ? [{ resource: r.value, actions }] : []
    })
  }

  function resetForm() {
    setName('')
    setExpiresAt('')
    setRateLimit('')
    const init = {} as Record<Resource, Set<Action>>
    RESOURCES.forEach((r) => (init[r.value] = new Set<Action>()))
    setPerms(init)
    setCreateError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const permissions = buildPermissions()
    if (!name.trim()) return setCreateError('Give the key a name.')
    if (permissions.length === 0) return setCreateError('Select at least one permission.')

    setCreating(true)
    try {
      const payload: Record<string, unknown> = { name: name.trim(), permissions }
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString()
      if (rateLimit) payload.rateLimit = Number(rateLimit)

      const res = await fetch(scopedApiPath('/api/v1/org/api-keys', scope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok || body.success === false) {
        throw new Error(body.error || body.message || 'Failed to create key')
      }
      const data = body.data ?? body
      setNewKey({ keyPrefix: data.keyPrefix, rawKey: data.rawKey })
      setCopied(false)
      resetForm()
      setShowForm(false)
      await loadKeys()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!newKey) return
    try {
      await navigator.clipboard.writeText(newKey.rawKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function handleRevoke(key: ApiKeyRow) {
    if (!window.confirm(`Revoke "${key.name}"? Any integration using this key will stop working immediately.`)) {
      return
    }
    setRevokingId(key.id)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/org/api-keys/${key.id}`, scope), { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) {
        throw new Error(body.error || body.message || 'Failed to revoke key')
      }
      await loadKeys()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke key')
    } finally {
      setRevokingId(null)
    }
  }

  const activeCount = keys.filter((k) => keyStatus(k).tone === 'success').length

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Workspace settings</p>
          <h1 className="pib-page-title mt-2">API keys</h1>
          <p className="pib-page-sub max-w-2xl">
            Issue scoped API keys so agents and integrations can act on this workspace. Keys are shown once at
            creation — store them securely.
          </p>
        </div>
        <button
          type="button"
          className="pib-btn-primary shrink-0"
          onClick={() => {
            setShowForm((v) => !v)
            setNewKey(null)
          }}
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            {showForm ? 'close' : 'add'}
          </span>
          {showForm ? 'Cancel' : 'Create key'}
        </button>
      </div>

      {/* Raw key reveal — shown ONCE */}
      {newKey && (
        <div className="pib-card border border-[var(--color-pib-accent)]/40 bg-[var(--color-pib-accent-soft)] p-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">
              vpn_key
            </span>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">Your new API key</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Copy this key now. For security it is hashed on our side and{' '}
                  <strong className="text-[var(--color-pib-text)]">will not be shown again</strong>.
                </p>
              </div>
              <div className="flex items-stretch gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 font-mono text-xs text-[var(--color-pib-text)]">
                  {newKey.rawKey}
                </code>
                <button type="button" className="pib-btn-secondary shrink-0" onClick={handleCopy}>
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    {copied ? 'check' : 'content_copy'}
                  </span>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button
                type="button"
                className="text-xs text-[var(--color-pib-text-muted)] underline underline-offset-2 hover:text-[var(--color-pib-text)]"
                onClick={() => setNewKey(null)}
              >
                I&rsquo;ve saved it — dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">New API key</p>
          </div>
          <div className="space-y-5 p-5">
            <div>
              <label htmlFor="key-name" className="mb-1.5 block text-xs font-medium text-[var(--color-pib-text)]">
                Name
              </label>
              <input
                id="key-name"
                type="text"
                className="pib-input"
                placeholder="e.g. Zapier integration"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-[var(--color-pib-text)]">Permissions</p>
              <p className="mb-3 text-xs text-[var(--color-pib-text-muted)]">
                Grant the minimum scopes this key needs. Each row is a resource; tick the actions to allow.
              </p>
              <div className="overflow-hidden rounded-xl border border-[var(--color-pib-line)]">
                {RESOURCES.map((r, idx) => (
                  <div
                    key={r.value}
                    className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                      idx > 0 ? 'border-t border-[var(--color-pib-line)]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]"
                        aria-hidden="true"
                      >
                        {r.icon}
                      </span>
                      <span className="text-sm text-[var(--color-pib-text)]">{r.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ACTIONS.map((a) => {
                        const active = perms[r.value].has(a.value)
                        return (
                          <button
                            key={a.value}
                            type="button"
                            onClick={() => toggleAction(r.value, a.value)}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                              active
                                ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]'
                                : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                            }`}
                            aria-pressed={active}
                          >
                            {a.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="key-expiry" className="mb-1.5 block text-xs font-medium text-[var(--color-pib-text)]">
                  Expiry <span className="text-[var(--color-pib-text-muted)]">(optional)</span>
                </label>
                <input
                  id="key-expiry"
                  type="date"
                  className="pib-input"
                  value={expiresAt}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="key-rate" className="mb-1.5 block text-xs font-medium text-[var(--color-pib-text)]">
                  Rate limit <span className="text-[var(--color-pib-text-muted)]">(requests / min, optional)</span>
                </label>
                <input
                  id="key-rate"
                  type="number"
                  min={1}
                  step={1}
                  className="pib-input"
                  placeholder="e.g. 60"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                />
              </div>
            </div>

            {createError && (
              <p className="text-xs text-[var(--color-pib-danger,#ef4444)]">{createError}</p>
            )}

            <div className="flex items-center gap-3">
              <button type="submit" className="pib-btn-primary" disabled={creating}>
                {creating ? 'Creating…' : 'Create key'}
              </button>
              <button
                type="button"
                className="pib-btn-secondary"
                onClick={() => {
                  resetForm()
                  setShowForm(false)
                }}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Key list */}
      <section className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Active keys</p>
          <span className="text-xs text-[var(--color-pib-text-muted)]">
            {activeCount} active · {keys.length} total
          </span>
        </div>

        <div className="p-5">
          {loading ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">Loading keys…</p>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-pib-danger,#ef4444)]">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                error
              </span>
              {error}
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-pib-line)] px-6 py-10 text-center">
              <span
                className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]"
                aria-hidden="true"
              >
                key_off
              </span>
              <p className="mt-2 text-sm text-[var(--color-pib-text)]">No API keys yet</p>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                Create a scoped key to let an agent or integration work on this workspace.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {keys.map((key) => {
                const status = keyStatus(key)
                const revoked = !!key.revokedAt
                return (
                  <li
                    key={key.id}
                    className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--color-pib-text)]">{key.name}</span>
                          <span
                            className={`pib-pill ${
                              status.tone === 'success'
                                ? 'pib-pill-success'
                                : status.tone === 'danger'
                                  ? 'pib-pill-danger'
                                  : ''
                            }`}
                          >
                            {status.label}
                          </span>
                          <code className="rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-pib-text-muted)]">
                            {key.keyPrefix}…
                          </code>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {key.permissions.length === 0 ? (
                            <span className="text-xs text-[var(--color-pib-text-muted)]">No scopes</span>
                          ) : (
                            key.permissions.map((p) => (
                              <span
                                key={p.resource}
                                className="rounded-md border border-[var(--color-pib-line)] px-2 py-0.5 text-[11px] text-[var(--color-pib-text-muted)]"
                              >
                                {p.resource}:{p.actions.join('/')}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-pib-text-muted)]">
                          <span>Created {formatDate(key.createdAt)}</span>
                          <span>Last used {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'never'}</span>
                          <span>
                            Expires{' '}
                            {toMillis(key.expiresAt) !== null ? formatDate(key.expiresAt) : 'never'}
                          </span>
                          {key.rateLimitPerMin ? <span>{key.rateLimitPerMin} req/min</span> : null}
                        </div>
                      </div>
                      {!revoked && (
                        <button
                          type="button"
                          className="pib-btn-secondary shrink-0"
                          onClick={() => handleRevoke(key)}
                          disabled={revokingId === key.id}
                        >
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                            delete
                          </span>
                          {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
