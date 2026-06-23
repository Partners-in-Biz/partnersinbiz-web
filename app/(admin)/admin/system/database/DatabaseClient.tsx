'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface CollectionRow {
  name: string
  count: number
}

interface DocRow {
  id: string
  data: unknown
}

interface MigrationRow {
  id?: string
  name?: string
  [key: string]: unknown
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function JsonBox({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100 font-mono whitespace-pre">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export default function DatabaseClient() {
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [colLoading, setColLoading] = useState(true)
  const [colError, setColError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [lookupId, setLookupId] = useState('')
  const [lookupResult, setLookupResult] = useState<DocRow | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // delete modal state
  const [deleteTarget, setDeleteTarget] = useState<{ collection: string; docId: string } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [migrations, setMigrations] = useState<MigrationRow[] | null>(null)
  const [migrationsLoading, setMigrationsLoading] = useState(true)

  // --- super-admin status ---
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setIsSuperAdmin(Boolean(body?.isSuperAdmin))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // --- collections ---
  const loadCollections = useCallback(async () => {
    setColLoading(true)
    setColError(null)
    try {
      const res = await fetch('/api/v1/admin/system/database')
      const body = await res.json()
      if (!res.ok) {
        setColError(body?.error ?? 'Failed to load collections')
        return
      }
      const data = body.data ?? body
      setCollections(data.collections ?? [])
    } catch (err) {
      setColError(err instanceof Error ? err.message : 'Failed to load collections')
    } finally {
      setColLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCollections()
  }, [loadCollections])

  // --- migrations ---
  useEffect(() => {
    let cancelled = false
    setMigrationsLoading(true)
    fetch('/api/v1/admin/system/migrations')
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok || !body) {
          setMigrations([])
          return
        }
        const data = body.data ?? body
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.migrations)
            ? data.migrations
            : []
        setMigrations(list as MigrationRow[])
      })
      .catch(() => {
        if (!cancelled) setMigrations([])
      })
      .finally(() => {
        if (!cancelled) setMigrationsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // --- documents ---
  const loadDocs = useCallback(async (collection: string, cursor: string | null) => {
    const isFirst = cursor === null
    if (isFirst) {
      setDocsLoading(true)
      setDocs([])
      setNextCursor(null)
      setDocsError(null)
    } else {
      setLoadingMore(true)
    }
    try {
      const params = new URLSearchParams({ limit: '25' })
      if (cursor) params.set('startAfter', cursor)
      const res = await fetch(`/api/v1/admin/system/database/${encodeURIComponent(collection)}?${params}`)
      const body = await res.json()
      if (!res.ok) {
        setDocsError(body?.error ?? 'Failed to load documents')
        return
      }
      const data = body.data ?? body
      setDocs((prev) => (isFirst ? data.docs ?? [] : [...prev, ...(data.docs ?? [])]))
      setNextCursor(data.nextCursor ?? null)
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : 'Failed to load documents')
    } finally {
      setDocsLoading(false)
      setLoadingMore(false)
    }
  }, [])

  const selectCollection = useCallback(
    (name: string) => {
      setSelected(name)
      setExpanded({})
      setLookupResult(null)
      setLookupError(null)
      setLookupId('')
      setExportError(null)
      loadDocs(name, null)
    },
    [loadDocs],
  )

  // --- lookup single doc ---
  const lookupDoc = useCallback(async () => {
    if (!selected || !lookupId.trim()) return
    setLookupLoading(true)
    setLookupError(null)
    setLookupResult(null)
    try {
      const res = await fetch(
        `/api/v1/admin/system/database/${encodeURIComponent(selected)}/${encodeURIComponent(lookupId.trim())}`,
      )
      const body = await res.json()
      if (!res.ok) {
        setLookupError(body?.error ?? 'Lookup failed')
        return
      }
      const data = body.data ?? body
      setLookupResult({ id: data.id, data: data.data })
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLookupLoading(false)
    }
  }, [selected, lookupId])

  // --- export ---
  const exportCollection = useCallback(async () => {
    if (!selected) return
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch(`/api/v1/admin/system/database/${encodeURIComponent(selected)}/export`)
      const body = await res.json()
      if (!res.ok) {
        setExportError(body?.error ?? 'Export failed')
        return
      }
      const data = body.data ?? body
      const blob = new Blob([JSON.stringify(data.docs, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selected}-export.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [selected])

  // --- delete ---
  const openDelete = useCallback((collection: string, docId: string) => {
    setDeleteTarget({ collection, docId })
    setConfirmText('')
    setDeleteError(null)
  }, [])

  const confirmTokenExpected = deleteTarget ? `${deleteTarget.collection}/${deleteTarget.docId}` : ''
  const deleteEnabled = Boolean(deleteTarget) && confirmText === confirmTokenExpected

  const runDelete = useCallback(async () => {
    if (!deleteTarget || !deleteEnabled) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const token = `${deleteTarget.collection}/${deleteTarget.docId}`
      const res = await fetch(
        `/api/v1/admin/system/database/${encodeURIComponent(deleteTarget.collection)}/${encodeURIComponent(
          deleteTarget.docId,
        )}?confirm=${encodeURIComponent(token)}`,
        { method: 'DELETE' },
      )
      const body = await res.json()
      if (!res.ok) {
        setDeleteError(body?.error ?? 'Delete failed')
        return
      }
      // Remove from lists
      setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.docId))
      if (lookupResult?.id === deleteTarget.docId) setLookupResult(null)
      setDeleteTarget(null)
      // Refresh counts in background
      loadCollections()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleteEnabled, lookupResult, loadCollections])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant">database</span>
        <div>
          <h1 className="text-2xl font-semibold">Database</h1>
          <p className="text-sm text-on-surface-variant">
            Browse Firestore collections and documents. Destructive actions are super-admin only.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Left: collection list */}
        <div className="pib-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
              Collections
            </h2>
            <button
              onClick={loadCollections}
              className="text-on-surface-variant hover:text-on-surface"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-lg">refresh</span>
            </button>
          </div>

          {colLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          ) : colError ? (
            <p className="text-sm text-red-600">{colError}</p>
          ) : collections.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No collections found.</p>
          ) : (
            <ul className="space-y-1">
              {collections.map((c) => (
                <li key={c.name}>
                  <button
                    onClick={() => selectCollection(c.name)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selected === c.name ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span className="truncate font-mono">{c.name}</span>
                    <span
                      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        selected === c.name ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {c.count < 0 ? '—' : c.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: documents */}
        <div className="space-y-4">
          {!selected ? (
            <div className="pib-card flex min-h-[200px] items-center justify-center p-8 text-center">
              <p className="text-sm text-on-surface-variant">
                Select a collection on the left to browse its documents.
              </p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="pib-card flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <h2 className="font-mono text-lg font-semibold">{selected}</h2>
                  <p className="text-xs text-on-surface-variant">{docs.length} loaded</p>
                </div>
                {isSuperAdmin && (
                  <button
                    onClick={exportCollection}
                    disabled={exporting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">download</span>
                    {exporting ? 'Exporting…' : 'Export JSON'}
                  </button>
                )}
              </div>
              {exportError && <p className="text-sm text-red-600">{exportError}</p>}

              {/* Lookup by ID */}
              <div className="pib-card p-4">
                <label className="mb-2 block text-sm font-medium">Look up document by ID</label>
                <div className="flex gap-2">
                  <input
                    value={lookupId}
                    onChange={(e) => setLookupId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && lookupDoc()}
                    placeholder="document id"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                  <button
                    onClick={lookupDoc}
                    disabled={lookupLoading || !lookupId.trim()}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {lookupLoading ? 'Looking…' : 'Look up'}
                  </button>
                </div>
                {lookupError && <p className="mt-2 text-sm text-red-600">{lookupError}</p>}
                {lookupResult && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-on-surface-variant">{lookupResult.id}</span>
                      {isSuperAdmin && (
                        <button
                          onClick={() => openDelete(selected, lookupResult.id)}
                          className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                          Delete
                        </button>
                      )}
                    </div>
                    <JsonBox value={lookupResult.data} />
                  </div>
                )}
              </div>

              {/* Document list */}
              <div className="pib-card p-4">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
                  Documents
                </h3>
                {docsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-lg" />
                    ))}
                  </div>
                ) : docsError ? (
                  <p className="text-sm text-red-600">{docsError}</p>
                ) : docs.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">This collection has no documents.</p>
                ) : (
                  <ul className="space-y-2">
                    {docs.map((doc) => {
                      const isOpen = Boolean(expanded[doc.id])
                      return (
                        <li key={doc.id} className="rounded-lg border border-slate-200">
                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <button
                              onClick={() => setExpanded((p) => ({ ...p, [doc.id]: !isOpen }))}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <span className="material-symbols-outlined text-base text-on-surface-variant">
                                {isOpen ? 'expand_less' : 'expand_more'}
                              </span>
                              <span className="truncate font-mono text-sm">{doc.id}</span>
                            </button>
                            {isSuperAdmin && (
                              <button
                                onClick={() => openDelete(selected, doc.id)}
                                className="shrink-0 text-on-surface-variant hover:text-red-600"
                                title="Delete document"
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                              </button>
                            )}
                          </div>
                          {isOpen && (
                            <div className="px-3 pb-3">
                              <JsonBox value={doc.data} />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {nextCursor && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={() => selected && loadDocs(selected, nextCursor)}
                      disabled={loadingMore}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Maintenance scripts */}
      <div className="pib-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
            Maintenance scripts
          </h2>
          <Link
            href="/admin/system/migrations"
            className="text-sm text-blue-600 hover:underline"
          >
            Open migrations
          </Link>
        </div>
        {migrationsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-2/3 rounded-lg" />
          </div>
        ) : migrations && migrations.length > 0 ? (
          <ul className="space-y-1">
            {migrations.map((m, i) => (
              <li key={m.id ?? m.name ?? i}>
                <Link
                  href="/admin/system/migrations"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-100"
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant">
                    terminal
                  </span>
                  <span className="font-mono">{m.name ?? m.id ?? `migration ${i + 1}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-on-surface-variant">
            No maintenance scripts registered yet.{' '}
            <Link href="/admin/system/migrations" className="text-blue-600 hover:underline">
              Manage migrations
            </Link>
            .
          </p>
        )}
      </div>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-red-600">warning</span>
              <h3 className="text-lg font-semibold">Delete document</h3>
            </div>
            <p className="mb-3 text-sm text-on-surface-variant">
              This permanently deletes the document. To confirm, type{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-red-700">
                {confirmTokenExpected}
              </code>{' '}
              below.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmTokenExpected}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              autoFocus
            />
            {deleteError && <p className="mb-3 text-sm text-red-600">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runDelete}
                disabled={!deleteEnabled || deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
