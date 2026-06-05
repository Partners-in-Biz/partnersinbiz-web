'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
}

interface Props {
  currentFilters: Record<string, unknown>
  onSelectView: (filters: Record<string, unknown>) => void
  resourceKind?: string
  orgScope?: Pick<PortalOrgRouteScope, 'orgId' | 'id'>
}

function savedViewDisplayName(view: SavedView) {
  return view.name?.trim() || 'Saved view name missing'
}

export function SavedViewsBar({
  currentFilters,
  onSelectView,
  resourceKind = 'contacts',
  orgScope,
}: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDeleteView, setPendingDeleteView] = useState<SavedView | null>(null)

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
      const res = await fetch(scopedApiPath(`/api/v1/crm/saved-views?resourceKind=${resourceKind}`, orgScope ?? {}))
      if (res.ok) {
        const body = await res.json()
        const raw = body.data?.views ?? body.data ?? []
        setViews(raw)
      }
    } catch {
      // silent — views are non-critical
    }
  }, [orgScope, resourceKind])

  useEffect(() => {
    void load()
  }, [load])

  async function saveView() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/saved-views', orgScope ?? {}), {
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
    await fetch(scopedApiPath(`/api/v1/crm/saved-views/${pendingDeleteView.id}`, orgScope ?? {}), { method: 'DELETE' })
    setPendingDeleteView(null)
    load()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') saveView()
    if (e.key === 'Escape') {
      setShowSaveForm(false)
      setNewName('')
    }
  }

  return (
    <div className="pib-card-section p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Saved view command center</p>
          <h2 className="font-display text-xl mt-1">Keep repeat CRM lenses one click away.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 max-w-2xl">
            Capture the current filters, switch between working lists, and keep the CRM focused on the next action.
          </p>
        </div>

        {showSaveForm ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="View name"
              className="pib-input text-sm !w-48"
            />
            <button
              onClick={saveView}
              disabled={saving || !newName.trim()}
              className="btn-pib-accent !text-xs !px-3 !py-1.5"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setShowSaveForm(false)
                setNewName('')
              }}
              className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
              aria-label="Cancel saved view form"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveForm(true)}
            className="btn-pib-accent !text-xs !px-3 !py-2"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">bookmark_add</span>
            Save current view
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Saved views</p>
          <p className="font-display text-2xl mt-1">{views.length}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Active filters</p>
          <p className="font-display text-2xl mt-1">
            {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3 min-w-0">
          <p className="eyebrow !text-[10px]">Current lens</p>
          <p className="text-sm mt-1 text-[var(--color-pib-text)] truncate" title={currentLensLabel}>
            {currentLensLabel}
          </p>
        </div>
      </div>

      {pendingDeleteView && (
        <section
          role="alertdialog"
          aria-labelledby="saved-view-delete-title"
          aria-describedby="saved-view-delete-description"
          className="rounded-[var(--radius-card)] border border-red-500/30 bg-red-500/10 p-4 shadow-xl"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-300" aria-hidden="true">
                warning
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-red-200">Saved view delete confirmation</p>
                <h3 id="saved-view-delete-title" className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                  Delete saved view &quot;{pendingDeleteViewName}&quot;?
                </h3>
                <p id="saved-view-delete-description" className="mt-2 text-sm text-red-100/90">
                  This removes the shared CRM lens for everyone using the {resourceLabel} workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteView(null)}
                className="btn-pib-secondary text-xs"
                aria-label={`Cancel delete for saved view ${pendingDeleteViewName}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteView}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-card)] border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/25"
                aria-label={`Confirm delete saved view ${pendingDeleteViewName}`}
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  delete
                </span>
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

            return (
              <div
                key={view.id}
                className="group rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3 flex items-center justify-between gap-3"
              >
                <button
                  onClick={() => onSelectView(view.filters)}
                  className="min-w-0 text-left flex-1"
                  aria-label={`Apply saved view ${displayName}`}
                >
                  <span className="block font-medium truncate text-[var(--color-pib-text)]">{displayName}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                    {filterCount} filter{filterCount === 1 ? '' : 's'}
                  </span>
                </button>
                <button
                  onClick={() => deleteView(view)}
                  title={`Delete "${displayName}"`}
                  aria-label={`Delete saved view ${displayName}`}
                  className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-danger,#FCA5A5)] transition-colors p-1 rounded-md hover:bg-red-400/10"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className="material-symbols-outlined rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-2 text-[20px] text-[var(--color-pib-accent)]"
                aria-hidden="true"
              >
                saved_search
              </span>
              <div>
                <p className="eyebrow !text-[10px]">Repeatable workflow</p>
                <h3 className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                  Create the first reusable contact lens
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                  Save this filtered contact list so every employee can reopen the same owner, stage, or follow-up view
                  without rebuilding it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              className="btn-pib-secondary shrink-0 text-xs"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                bookmark_add
              </span>
              Save this working list
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-3">
              <p className="eyebrow !text-[10px]">Ready now</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">
                {activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'} ready to save
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-3">
              <p className="eyebrow !text-[10px]">Team value</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">One shared working list</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-3">
              <p className="eyebrow !text-[10px]">Best use</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">Owner gaps and follow-ups</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
