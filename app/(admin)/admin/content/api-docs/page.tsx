'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'

interface ApiEndpoint {
  method: string
  path: string
  group: string
  description: string
  notes: string
}

interface ApiGroup {
  group: string
  endpoints: ApiEndpoint[]
}

interface ApiDocsPayload {
  apiVersion: string
  version: string
  totalEndpoints: number
  groups: ApiGroup[]
}

interface PatchResult {
  key: string
  description: string
  notes: string
}

function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

function methodChipStyle(method: string): React.CSSProperties {
  const m = method.toUpperCase()
  if (m === 'GET') return { background: 'rgba(34,197,94,0.15)', color: '#4ade80' }
  if (m === 'POST') return { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }
  if (m === 'PATCH' || m === 'PUT') return { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
  if (m === 'DELETE') return { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
  return { background: 'rgba(148,163,184,0.15)', color: '#cbd5e1' }
}

function methodHasBody(method: string): boolean {
  const m = method.toUpperCase()
  return m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE'
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function ApiDocsPage() {
  const [payload, setPayload] = useState<ApiDocsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Docs editor state
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  // Try-it console state
  const [tryEndpoint, setTryEndpoint] = useState<ApiEndpoint | null>(null)
  const [tryPath, setTryPath] = useState('')
  const [tryBody, setTryBody] = useState('')
  const [sending, setSending] = useState(false)
  const [respStatus, setRespStatus] = useState<number | null>(null)
  const [respText, setRespText] = useState<string | null>(null)
  const [respError, setRespError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/content/api-docs')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load API docs')
        setPayload(null)
      } else {
        setPayload((body.data ?? null) as ApiDocsPayload | null)
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load API docs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredGroups = useMemo<ApiGroup[]>(() => {
    if (!payload) return []
    const q = search.trim().toLowerCase()
    if (!q) return payload.groups
    return payload.groups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (e) => e.path.toLowerCase().includes(q) || e.method.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.endpoints.length > 0)
  }, [payload, search])

  function openEdit(ep: ApiEndpoint) {
    const key = endpointKey(ep.method, ep.path)
    setEditingKey(key)
    setEditDescription(ep.description ?? '')
    setEditNotes(ep.notes ?? '')
    setSaveError(null)
    setSavedKey(null)
  }

  function cancelEdit() {
    setEditingKey(null)
    setSaveError(null)
  }

  async function saveEdit(ep: ApiEndpoint) {
    setSaving(true)
    setSaveError(null)
    setSavedKey(null)
    try {
      const res = await fetch('/api/v1/admin/content/api-docs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: ep.method,
          path: ep.path,
          description: editDescription,
          notes: editNotes,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body?.error ?? 'Failed to save docs')
        return
      }
      const result = (body.data ?? {}) as Partial<PatchResult>
      const key = endpointKey(ep.method, ep.path)
      // Update local state with returned values.
      setPayload((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          groups: prev.groups.map((g) => ({
            ...g,
            endpoints: g.endpoints.map((e) =>
              endpointKey(e.method, e.path) === key
                ? {
                    ...e,
                    description: result.description ?? editDescription,
                    notes: result.notes ?? editNotes,
                  }
                : e,
            ),
          })),
        }
      })
      setSavedKey(key)
      setEditingKey(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save docs')
    } finally {
      setSaving(false)
    }
  }

  function openTry(ep: ApiEndpoint) {
    setTryEndpoint(ep)
    setTryPath(ep.path)
    setTryBody('')
    setRespStatus(null)
    setRespText(null)
    setRespError(null)
  }

  function closeTry() {
    setTryEndpoint(null)
    setRespStatus(null)
    setRespText(null)
    setRespError(null)
  }

  async function sendTry() {
    if (!tryEndpoint) return
    setSending(true)
    setRespStatus(null)
    setRespText(null)
    setRespError(null)

    const method = tryEndpoint.method.toUpperCase()
    const init: RequestInit = { method }

    if (methodHasBody(method) && tryBody.trim() !== '') {
      let parsed: unknown
      try {
        parsed = JSON.parse(tryBody)
      } catch (err) {
        setRespError(`Invalid JSON body: ${err instanceof Error ? err.message : 'parse error'}`)
        setSending(false)
        return
      }
      init.headers = { 'content-type': 'application/json' }
      init.body = JSON.stringify(parsed)
    }

    try {
      const res = await fetch(tryPath, init)
      setRespStatus(res.status)
      const raw = await res.text()
      try {
        const json: unknown = JSON.parse(raw)
        setRespText(JSON.stringify(json, null, 2))
      } catch {
        setRespText(raw)
      }
    } catch (err) {
      setRespError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  const tryHasBody = tryEndpoint ? methodHasBody(tryEndpoint.method) : false

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Content / API
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">API Documentation</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Reference for every public platform endpoint. Edit descriptions and notes inline, and run
            real requests against the live API with the try-it console.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {payload && (
            <span
              className="text-[11px] font-label uppercase tracking-wide px-3 py-1 rounded-full font-mono"
              style={{ background: 'var(--color-accent-v2)20', color: 'var(--color-accent-v2)' }}
            >
              API {payload.apiVersion} · build {payload.version}
            </span>
          )}
          {payload && (
            <span className="text-[11px] font-label uppercase tracking-wide px-3 py-1 rounded-full bg-on-surface/10 text-on-surface-variant">
              {payload.totalEndpoints} endpoints
            </span>
          )}
        </div>
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}

      {/* Try-it console */}
      {tryEndpoint && (
        <div className="pib-card p-5 space-y-4 border-[var(--color-card-border)] bg-[var(--color-surface-container)]">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-headline font-bold text-on-surface inline-flex items-center gap-2">
              <span className="material-icons text-base" style={{ color: 'var(--color-accent-v2)' }}>
                terminal
              </span>
              Try it
            </h2>
            <button type="button" onClick={closeTry} className="pib-btn-ghost text-xs font-label">
              Close
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span
              className="text-[11px] font-label uppercase tracking-wide px-2 py-1 rounded-md shrink-0 text-center"
              style={methodChipStyle(tryEndpoint.method)}
            >
              {tryEndpoint.method.toUpperCase()}
            </span>
            <input
              type="text"
              value={tryPath}
              onChange={(e) => setTryPath(e.target.value)}
              placeholder="/api/v1/..."
              className="pib-input w-full font-mono text-sm"
              spellCheck={false}
            />
          </div>

          {tryHasBody && (
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Request body (JSON)
              </span>
              <textarea
                value={tryBody}
                onChange={(e) => setTryBody(e.target.value)}
                placeholder='{ "key": "value" }'
                className="pib-input w-full mt-1 min-h-[96px] font-mono text-sm"
                rows={4}
                spellCheck={false}
              />
            </label>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={sendTry}
              disabled={sending}
              className="pib-btn-primary text-sm font-label"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>

          {respError && <p className="text-xs text-red-400">{respError}</p>}

          {respStatus !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                  Status
                </span>
                <span
                  className="text-sm font-mono font-semibold"
                  style={{
                    color: respStatus >= 200 && respStatus < 300 ? '#4ade80' : '#f87171',
                  }}
                >
                  {respStatus}
                </span>
              </div>
              {respText !== null && (
                <pre className="text-xs font-mono text-on-surface bg-on-surface/5 rounded-md p-3 overflow-auto max-h-80 border border-[var(--color-card-border)]">
                  {respText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-base text-on-surface-variant pointer-events-none">
          search
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter endpoints by path or method…"
          className="pib-input w-full pl-10"
          spellCheck={false}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : !payload ? (
        <div className="pib-card p-8 text-center">
          <p className="text-sm text-on-surface-variant">No API documentation available.</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <p className="text-sm text-on-surface-variant">No endpoints match “{search}”.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <section key={group.group} className="pib-card p-5">
              <h2 className="text-base font-headline font-bold text-on-surface mb-3">
                {group.group}
                <span className="ml-2 text-xs font-normal text-on-surface-variant">
                  {group.endpoints.length}
                </span>
              </h2>
              <ul className="divide-y divide-[var(--color-card-border)]">
                {group.endpoints.map((ep) => {
                  const key = endpointKey(ep.method, ep.path)
                  const isEditing = editingKey === key
                  const wasSaved = savedKey === key
                  return (
                    <li key={key} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex items-start gap-3">
                          <span
                            className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded-md shrink-0 w-16 text-center"
                            style={methodChipStyle(ep.method)}
                          >
                            {ep.method.toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="font-mono text-sm text-on-surface break-all">{ep.path}</p>
                            {ep.description && (
                              <p className="text-xs text-on-surface-variant mt-0.5">{ep.description}</p>
                            )}
                            {wasSaved && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-green-400 mt-1">
                                <span className="material-icons text-xs">check_circle</span>
                                Saved
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0 lg:justify-end">
                          <button
                            type="button"
                            onClick={() => openEdit(ep)}
                            className="pib-btn-secondary text-xs font-label"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openTry(ep)}
                            className="pib-btn-ghost text-xs font-label"
                          >
                            Try
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mt-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-4 space-y-3">
                          <label className="block">
                            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                              Description
                            </span>
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="pib-input w-full mt-1"
                              placeholder="Short summary of what this endpoint does."
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                              Notes
                            </span>
                            <textarea
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="pib-input w-full mt-1 min-h-[80px]"
                              rows={3}
                              placeholder="Implementation notes, gotchas, required scopes…"
                            />
                          </label>
                          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="pib-btn-ghost text-xs font-label"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(ep)}
                              disabled={saving}
                              className="pib-btn-primary text-xs font-label"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
