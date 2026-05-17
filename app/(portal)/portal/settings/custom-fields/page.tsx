// app/(portal)/portal/settings/custom-fields/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { CustomFieldDefinitionsList } from '@/components/crm/CustomFieldDefinitionsList'
import { CustomFieldDefinitionDrawer } from '@/components/crm/CustomFieldDefinitionDrawer'
import type { CustomFieldDefinition, CustomFieldResource } from '@/lib/customFields/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { resource: CustomFieldResource; label: string }[] = [
  { resource: 'contact', label: 'Contact' },
  { resource: 'deal', label: 'Deal' },
  { resource: 'company', label: 'Company' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CustomFieldsPage() {
  const [activeTab, setActiveTab] = useState<CustomFieldResource>('contact')
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingDef, setEditingDef] = useState<Partial<CustomFieldDefinition> | undefined>(undefined)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Role fetch ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/v1/portal/settings/profile')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.profile?.role) setRole(d.profile.role) })
      .catch(() => {})
  }, [])

  // ── Definitions fetch ─────────────────────────────────────────────────────────

  const fetchDefs = useCallback(async (resource: CustomFieldResource) => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/v1/crm/custom-fields?resource=${resource}`)
      if (res.status === 404) {
        setFetchError('Custom fields API is not yet available. It will be ready shortly.')
        setDefinitions([])
        return
      }
      if (!res.ok) {
        setFetchError('Failed to load custom fields. Please try again.')
        setDefinitions([])
        return
      }
      const body = await res.json()
      const defs: CustomFieldDefinition[] = body.data?.definitions ?? body.definitions ?? []
      setDefinitions(defs)
    } catch {
      setFetchError('Could not reach the server. Check your connection.')
      setDefinitions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDefs(activeTab)
  }, [activeTab, fetchDefs])

  // ── Role gate ─────────────────────────────────────────────────────────────────

  const isAdmin = role === 'admin' || role === 'owner'

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingDef(undefined)
    setDrawerMode('create')
    setDrawerOpen(true)
  }

  function openEdit(def: CustomFieldDefinition) {
    setEditingDef(def)
    setDrawerMode('edit')
    setDrawerOpen(true)
  }

  function openDelete(def: CustomFieldDefinition) {
    if (!confirm(`Delete "${def.label}"? This cannot be undone.`)) return
    handleDelete(def.id)
  }

  async function handleDelete(id: string) {
    // Optimistic remove
    setDefinitions(prev => prev.filter(d => d.id !== id))
    setDeletingId(id)
    try {
      const res = await fetch(`/api/v1/crm/custom-fields/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        // Revert on failure
        await fetchDefs(activeTab)
      }
    } catch {
      await fetchDefs(activeTab)
    } finally {
      setDeletingId(null)
    }
  }

  async function handleReorder(newIds: string[]) {
    // Optimistic local reorder
    const reordered = newIds
      .map(id => definitions.find(d => d.id === id))
      .filter(Boolean) as CustomFieldDefinition[]
    setDefinitions(reordered)

    try {
      const res = await fetch('/api/v1/crm/custom-fields/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: activeTab, ids: newIds }),
      })
      if (!res.ok) {
        await fetchDefs(activeTab)
      }
    } catch {
      await fetchDefs(activeTab)
    }
  }

  async function handleSave(def: Partial<CustomFieldDefinition>) {
    const isEdit = drawerMode === 'edit' && editingDef?.id
    const url = isEdit
      ? `/api/v1/crm/custom-fields/${editingDef!.id}`
      : '/api/v1/crm/custom-fields'
    const method = isEdit ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...def, resource: activeTab }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const err = new Error(body.error ?? 'Save failed')
      if (body.details) Object.assign(err, { details: body.details })
      throw err
    }

    await fetchDefs(activeTab)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const currentTab = TABS.find(t => t.resource === activeTab)!

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold mb-1">Custom fields</h1>
      <p className="text-sm text-[var(--color-pib-text-muted)] mb-6">
        Define custom fields for contacts, deals, and companies in this workspace.
      </p>

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">info</span>
          Only admins can manage custom fields.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--color-pib-line)]">
        {TABS.map(tab => (
          <button
            key={tab.resource}
            type="button"
            onClick={() => setActiveTab(tab.resource)}
            className={[
              'cursor-pointer px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.resource
                ? 'border-[var(--color-pib-accent)] text-[var(--color-pib-text)]'
                : 'border-transparent text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">
            Custom fields for {currentTab.label.toLowerCase()}s
          </h2>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add field
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
        ) : fetchError ? (
          <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
            {fetchError}
          </div>
        ) : definitions.length === 0 ? (
          <div className="px-5 py-8 rounded-xl border border-dashed border-[var(--color-pib-line)] text-center">
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              No custom fields yet.
              {isAdmin && (
                <> Click <span className="font-medium text-[var(--color-pib-text)]">Add field</span> to define your first one.</>
              )}
            </p>
          </div>
        ) : (
          <CustomFieldDefinitionsList
            definitions={definitions}
            isAdmin={isAdmin}
            onEdit={openEdit}
            onDelete={openDelete}
            onReorder={handleReorder}
          />
        )}
      </div>

      {/* Drawer */}
      <CustomFieldDefinitionDrawer
        open={drawerOpen}
        mode={drawerMode}
        resource={activeTab}
        definition={editingDef}
        onSave={handleSave}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Suppress unused var warning */}
      {deletingId && null}
    </div>
  )
}
