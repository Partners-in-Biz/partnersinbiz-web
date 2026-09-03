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
  if (m === 'GET') return { background: 'var(--color-pib-green-soft)', color: 'var(--color-pib-green)' }
  if (m === 'POST') return { background: 'var(--color-pib-blue-soft)', color: 'var(--color-pib-blue)' }
  if (m === 'PATCH' || m === 'PUT') return { background: 'var(--color-pib-amber-soft)', color: 'var(--color-pib-amber)' }
  if (m === 'DELETE') return { background: 'var(--color-pib-rose-soft)', color: 'var(--color-pib-rose)' }
  return { background: 'var(--color-pib-surface-2)', color: 'var(--color-pib-text-muted)' }
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
    <div className="space-y-8 max-w-6xl mx-auto">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Content · API</p>
          <h1 className="pib-page-title mt-2">API Documentation</h1>
          <p className="pib-page-sub max-w-2xl">
            Reference for every public platform endpoint. Edit descriptions and notes inline, and run
            real requests against the live API with the try-it console.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {payload && (
            <span className="st-status st-status st-status--info font-mono">
              API {payload.apiVersion} · build {payload.version}
            </span>
          )}
          {payload && (
            <span className="st-status">
              {payload.totalEndpoints} endpoints
            </span>
          )}
        </div>
      </header>

      {topError && (
        <div className="st-panel px-4 py-3 text-sm text-[var(--color-error)]">
          {topError}
        </div>
      )}

      {/* Try-it console */}
      {tryEndpoint && (
        <div className="st-panel p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-headline font-medium text-[var(--color-pib-text)] inline-flex items-center gap-2">
              <span className="material-icons text-base" style={{ color: "var(--color-pib-cyan)" }}>
                terminal
              </span>
              Try it
            </h2>
            <button type="button" onClick={closeTry} className="st-btn st-btn--ghost text-xs font-label">
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
              className="st-input w-full font-mono text-sm"
              spellCheck={false}
              aria-label="Request path"
            />
          </div>

          {tryHasBody && (
            <label className="block">
              <span className="sc-tiny">
                Request body (JSON)
              </span>
              <textarea
                value={tryBody}
                onChange={(e) => setTryBody(e.target.value)}
                placeholder='{ "key": "value" }'
                className="st-input w-full mt-1 min-h-[96px] font-mono text-sm"
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
              className="st-btn st-btn--primary text-sm font-label"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>

          {respError && <p className="text-xs text-[var(--color-error)]">{respError}</p>}

          {respStatus !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  Status
                </span>
                <span
                  className="text-sm font-mono font-medium"
                  style={{
                    color: respStatus >= 200 && respStatus < 300 ? "var(--color-pib-green)" : "var(--color-error)",
                  }}
                >
                  {respStatus}
                </span>
              </div>
              {respText !== null && (
                <pre className="text-xs font-mono text-[var(--color-pib-text)] bg-[var(--color-pib-surface)] rounded-md p-3 overflow-auto max-h-80 border border-[var(--color-pib-line)]">
                  {respText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-base text-[var(--color-pib-text-muted)] pointer-events-none">
          search
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter endpoints by path or method…"
          className="st-input w-full pl-10"
          spellCheck={false}
          aria-label="Filter endpoints"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-[6px]" />
          <Skeleton className="h-40 rounded-[6px]" />
        </div>
      ) : !payload ? (
        <div className="st-panel p-8 text-center">
          <p className="text-sm text-[var(--color-pib-text-muted)]">No API documentation available.</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="st-panel p-8 text-center">
          <p className="text-sm text-[var(--color-pib-text-muted)]">No endpoints match “{search}”.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <section key={group.group} className="st-panel p-5">
              <h2 className="text-base font-headline font-medium text-[var(--color-pib-text)] mb-3">
                {group.group}
                <span className="ml-2 text-xs font-normal text-[var(--color-pib-text-muted)]">
                  {group.endpoints.length}
                </span>
              </h2>
              <ul className="divide-y divide-[var(--color-pib-line)]">
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
                            <p className="font-mono text-sm text-[var(--color-pib-text)] break-all">{ep.path}</p>
                            {ep.description && (
                              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">{ep.description}</p>
                            )}
                            {wasSaved && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-pib-green)] mt-1">
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
                            className="st-btn st-btn--secondary text-xs font-label"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openTry(ep)}
                            className="st-btn st-btn--ghost text-xs font-label"
                          >
                            Try
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mt-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4 space-y-3">
                          <label className="block">
                            <span className="sc-tiny">
                              Description
                            </span>
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="st-input w-full mt-1"
                              placeholder="Short summary of what this endpoint does."
                            />
                          </label>
                          <label className="block">
                            <span className="sc-tiny">
                              Notes
                            </span>
                            <textarea
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="st-input w-full mt-1 min-h-[80px]"
                              rows={3}
                              placeholder="Implementation notes, gotchas, required scopes…"
                            />
                          </label>
                          {saveError && <p className="text-xs text-[var(--color-error)]">{saveError}</p>}
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="st-btn st-btn--ghost text-xs font-label"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(ep)}
                              disabled={saving}
                              className="st-btn st-btn--primary text-xs font-label"
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
