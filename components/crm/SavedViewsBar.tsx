'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
}

// Maps a saved view's stored filters to the server-resolvable subset of the
// contacts list query params, so we can count how many contacts each view
// currently matches. owner/followUp are client-side lenses the contacts API
// does not understand, so they are intentionally omitted from the count query
// (the count reflects the server-filterable portion of the view).
function viewFiltersToContactsQuery(filters: Record<string, unknown>): string {
  const params = new URLSearchParams()
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const search = str(filters.search)
  const stage = str(filters.stage)
  const type = str(filters.type)
  const status = str(filters.status)
  const utmSource = str(filters.utmSource)
  if (search) params.set('search', search)
  if (stage) params.set('stage', stage)
  if (type) params.set('type', type)
  if (status) params.set('status', status)
  if (utmSource) params.set('utmSource', utmSource)
  const tags = Array.isArray(filters.tags)
    ? filters.tags.filter((t): t is string => typeof t === 'string').join(',')
    : str(filters.tags)
  if (tags) params.set('tags', tags)
  if (filters.minScore !== undefined && filters.minScore !== '' && filters.minScore !== null) {
    params.set('minScore', String(filters.minScore))
  }
  // Count only - one row is enough to read meta.total.
  params.set('limit', '1')
  return params.toString()
}

interface Props {
  currentFilters: Record<string, unknown>
  onSelectView: (filters: Record<string, unknown>) => void
  resourceKind?: string
  orgScope?: PortalOrgRouteScope
}

function savedViewDisplayName(view: SavedView) {
  return view.name?.trim() || 'Saved view name missing'
}

export function SavedViewsBar({
  currentFilters,
  onSelectView,
  resourceKind = 'contacts',
  orgScope = {},
}: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDeleteView, setPendingDeleteView] = useState<SavedView | null>(null)
  // Per-view live contact counts: undefined = loading, number = resolved.
  const [viewCounts, setViewCounts] = useState<Record<string, number | undefined>>({})
  // Inline rename state for the Edit action.
  const [editingViewId, setEditingViewId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const activeFilters = useMemo(() => {
    return Object.entries(currentFilters).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === 'string') return value.trim().length > 0
      return value !== undefined && value !== null && value !== false && value !== ''
    })
  }, [currentFilters])

  const activeFilterCount = activeFilters.length
  const resourceLabel = resourceKind.replace(/-/g, ' ')
  const pendingDeleteViewName = pendingDeleteView ? savedViewDisplayName(pendingDeleteView) : ''
  const currentLensLabel = activeFilterCount
    ? activeFilters.map(([key, value]) => `${key}: ${String(value)}`).join(' / ')
    : `All ${resourceLabel}`

  const load = useCallback(async () => {
    try {
      const res = await fetch(scopedApiPath(`/api/v1/crm/saved-views?resourceKind=${encodeURIComponent(resourceKind)}`, orgScope))
      if (res.ok) {
        const body = await res.json()
        const raw = body.data?.views ?? body.data ?? []
        setViews(raw)
      }
    } catch {
      // silent - views are non-critical
    }
  }, [orgScope, resourceKind])

  useEffect(() => {
    void load()
  }, [load])

  // Resolve each view's filters against the contacts list endpoint and read
  // meta.total so the UI can show a live contact count next to each saved view.
  useEffect(() => {
    if (resourceKind !== 'contacts' || views.length === 0) return
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      const entries = await Promise.all(
        views.map(async (view): Promise<[string, number | undefined]> => {
          try {
            const qs = viewFiltersToContactsQuery(view.filters ?? {})
            const res = await fetch(
              scopedApiPath(`/api/v1/crm/contacts?${qs}`, orgScope),
              { signal: controller.signal },
            )
            if (!res.ok) return [view.id, undefined]
            const body = await res.json()
            const total = body?.meta?.total
            return [view.id, typeof total === 'number' ? total : undefined]
          } catch {
            return [view.id, undefined]
          }
        }),
      )
      if (!cancelled) {
        setViewCounts(Object.fromEntries(entries))
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [views, orgScope, resourceKind])

  async function saveView() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/saved-views', orgScope), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          resourceKind,
          filters: currentFilters,
        }),
      })
      if (res.ok) {
        setNewName('')
        setShowSaveForm(false)
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  function deleteView(view: SavedView) {
    setPendingDeleteView(view)
  }

  async function confirmDeleteView() {
    if (!pendingDeleteView) return
    await fetch(scopedApiPath(`/api/v1/crm/saved-views/${pendingDeleteView.id}`, orgScope), { method: 'DELETE' })
    setPendingDeleteView(null)
    load()
  }

  function startEditView(view: SavedView) {
    setEditingViewId(view.id)
    setEditName(savedViewDisplayName(view) === 'Saved view name missing' ? '' : view.name)
  }

  function cancelEditView() {
    setEditingViewId(null)
    setEditName('')
  }

  async function saveEditView() {
    if (!editingViewId || !editName.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/crm/saved-views/${editingViewId}`, orgScope), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      if (res.ok) {
        cancelEditView()
        load()
      }
    } finally {
      setEditSaving(false)
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') saveEditView()
    if (e.key === 'Escape') cancelEditView()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') saveView()
    if (e.key === 'Escape') {
      setShowSaveForm(false)
      setNewName('')
    }
  }

  return (
    <div className="space-y-2 rounded-[var(--st-radius-raised)] border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-0.5">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Saved view command center</p>
          <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">Keep repeat CRM lenses one click away.</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-[var(--color-pib-text-muted)]">
            Capture the current filters, switch between working lists, and keep the CRM focused on the next action.
          </p>
        </div>

        {showSaveForm ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="View name"
              aria-label="Saved view name"
              className="h-8 w-48 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none"
            />
            <button
              onClick={saveView}
              disabled={saving || !newName.trim()}
              className="flex h-8 items-center rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setShowSaveForm(false)
                setNewName('')
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              aria-label="Cancel saved view form"
            >
              <Icon name="close" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveForm(true)}
            className="flex h-8 items-center gap-1 rounded-md bg-[var(--color-accent-v2)] px-2.5 text-xs font-medium text-black transition-colors hover:opacity-90"
          >
            <Icon name="bookmark_add" />
            Save current view
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Saved views</p>
          <p className="mt-1 text-lg leading-none text-[var(--color-pib-text)]">{views.length}</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Active filters</p>
          <p className="mt-1 text-lg leading-none text-[var(--color-pib-text)]">
            {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="min-w-0 rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Current lens</p>
          <p className="mt-1 truncate text-sm text-[var(--color-pib-text)]" title={currentLensLabel}>
            {currentLensLabel}
          </p>
        </div>
      </div>

      {pendingDeleteView && (
        <section
          role="alertdialog"
          aria-labelledby="saved-view-delete-title"
          aria-describedby="saved-view-delete-description"
          className="rounded-lg border border-red-400/40 bg-red-400/10 p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-2.5">
              <Icon name="warning" className="mt-0.5 text-red-100" />
              <div>
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-red-100">Saved view delete confirmation</p>
                <h3 id="saved-view-delete-title" className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                  Delete saved view &quot;{pendingDeleteViewName}&quot;?
                </h3>
                <p id="saved-view-delete-description" className="mt-1 text-xs text-red-100/90">
                  This removes the shared CRM lens for everyone using the {resourceLabel} workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPendingDeleteView(null)}
                className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                aria-label={`Cancel delete for saved view ${pendingDeleteViewName}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteView}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 px-2.5 text-xs font-medium text-red-100 transition-colors hover:bg-red-400/20"
                aria-label={`Confirm delete saved view ${pendingDeleteViewName}`}
              >
                <Icon name="delete" />
                Delete saved view
              </button>
            </div>
          </div>
        </section>
      )}

      {views.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {views.map((view) => {
            const displayName = savedViewDisplayName(view)
            const filterCount = Object.entries(view.filters ?? {}).filter(([, value]) => {
              if (Array.isArray(value)) return value.length > 0
              if (typeof value === 'string') return value.trim().length > 0
              return value !== undefined && value !== null && value !== false && value !== ''
            }).length

            const isEditing = editingViewId === view.id
            const count = viewCounts[view.id]
            const countLabel =
              resourceKind !== 'contacts'
                ? null
                : count === undefined
                  ? 'counting…'
                  : `${count} contact${count === 1 ? '' : 's'}`

            if (isEditing) {
              return (
                <div
                  key={view.id}
                  className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 p-1.5"
                >
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    placeholder="View name"
                    className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none"
                    aria-label={`Rename saved view ${displayName}`}
                  />
                  <button
                    onClick={saveEditView}
                    disabled={editSaving || !editName.trim()}
                    className="flex h-8 items-center rounded-md bg-[var(--color-accent-v2)] px-2.5 text-xs font-medium text-black transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Save name for saved view ${displayName}`}
                  >
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditView}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                    aria-label="Cancel rename"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )
            }

            return (
              <div
                key={view.id}
                className="group flex items-center justify-between gap-1.5 rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
              >
                <button
                  onClick={() => onSelectView(view.filters)}
                  className="min-w-0 flex-1 text-left"
                  aria-label={`Apply saved view ${displayName}`}
                >
                  <span className="block truncate text-sm font-medium text-[var(--color-pib-text)]">{displayName}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                    {filterCount} filter{filterCount === 1 ? '' : 's'}
                    {countLabel ? <span aria-hidden="true"> · </span> : null}
                    {countLabel ? <span>{countLabel}</span> : null}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => startEditView(view)}
                    title={`Edit "${displayName}"`}
                    aria-label={`Edit saved view ${displayName}`}
                    className="rounded-md p-1 text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    onClick={() => deleteView(view)}
                    title={`Delete "${displayName}"`}
                    aria-label={`Delete saved view ${displayName}`}
                    className="rounded-md p-1 text-[var(--color-pib-text-muted)] transition-colors hover:bg-red-400/10 hover:text-red-100"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-black/10 p-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span aria-hidden="true" className="">
                <Icon name="saved_search" />
              </span>
              <div>
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Repeatable workflow</p>
                <h3 className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                  Create the first reusable contact lens
                </h3>
                <p className="mt-0.5 max-w-2xl text-xs text-[var(--color-pib-text-muted)]">
                  Save this filtered contact list so every employee can reopen the same owner, stage, or follow-up view
                  without rebuilding it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
            >
              <Icon name="bookmark_add" />
              Save this working list
            </button>
          </div>

          <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Ready now</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">
                {activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'} ready to save
              </p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Team value</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">One shared working list</p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Best use</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">Owner gaps and follow-ups</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
