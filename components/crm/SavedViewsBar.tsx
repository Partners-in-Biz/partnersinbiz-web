'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
}

interface Props {
  currentFilters: Record<string, unknown>
  onSelectView: (filters: Record<string, unknown>) => void
  resourceKind?: string
}

export function SavedViewsBar({
  currentFilters,
  onSelectView,
  resourceKind = 'contacts',
}: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const activeFilters = useMemo(() => {
    return Object.entries(currentFilters).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === 'string') return value.trim().length > 0
      return value !== undefined && value !== null && value !== false && value !== ''
    })
  }, [currentFilters])

  const activeFilterCount = activeFilters.length
  const resourceLabel = resourceKind.replace(/-/g, ' ')
  const currentLensLabel = activeFilterCount
    ? activeFilters.map(([key, value]) => `${key}: ${String(value)}`).join(' / ')
    : `All ${resourceLabel}`

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/crm/saved-views?resourceKind=${resourceKind}`)
      if (res.ok) {
        const body = await res.json()
        const raw = body.data?.views ?? body.data ?? []
        setViews(raw)
      }
    } catch {
      // silent — views are non-critical
    }
  }, [resourceKind])

  useEffect(() => {
    void load()
  }, [load])

  async function saveView() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/v1/crm/saved-views', {
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

  async function deleteView(id: string) {
    if (!confirm('Delete this saved view?')) return
    await fetch(`/api/v1/crm/saved-views/${id}`, { method: 'DELETE' })
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
            <span className="material-symbols-outlined text-[16px]">bookmark_add</span>
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

      {views.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {views.map((view) => {
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
                  aria-label={`Apply saved view ${view.name}`}
                >
                  <span className="block font-medium truncate text-[var(--color-pib-text)]">{view.name}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                    {filterCount} filter{filterCount === 1 ? '' : 's'}
                  </span>
                </button>
                <button
                  onClick={() => deleteView(view.id)}
                  title={`Delete "${view.name}"`}
                  aria-label={`Delete saved view ${view.name}`}
                  className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-danger,#FCA5A5)] transition-colors p-1 rounded-md hover:bg-red-400/10"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-pib-line)] p-4 text-sm text-[var(--color-pib-text-muted)]">
          No saved views yet. Save this lens once you have a repeatable working list.
        </div>
      )}
    </div>
  )
}
