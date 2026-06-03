// app/(portal)/portal/settings/custom-fields/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { CustomFieldDefinitionsList } from '@/components/crm/CustomFieldDefinitionsList'
import { CustomFieldDefinitionDrawer } from '@/components/crm/CustomFieldDefinitionDrawer'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { CustomFieldDefinition, CustomFieldResource, CustomFieldType } from '@/lib/customFields/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { resource: CustomFieldResource; label: string }[] = [
  { resource: 'contact', label: 'Contact' },
  { resource: 'deal', label: 'Deal' },
  { resource: 'company', label: 'Company' },
]

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  datetime: 'Date & time',
  dropdown: 'Dropdown',
  multi_select: 'Multi-select',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
}

type ReadinessFilter = 'all' | 'ready' | 'needs-work'

const FIELD_SETUP_BLUEPRINT = [
  {
    label: 'Qualification',
    value: 'Better fit calls',
    icon: 'verified_user',
    copy: 'Capture the extra signal sales needs to decide whether a record is worth attention.',
  },
  {
    label: 'Reporting',
    value: 'Cleaner dashboards',
    icon: 'monitoring',
    copy: 'Group fields so management can compare the same data across contacts, deals, and companies.',
  },
  {
    label: 'Handover',
    value: 'Employee clarity',
    icon: 'assignment_ind',
    copy: 'Add help text and required flags so every team member knows why the field matters.',
  },
  {
    label: 'Governance',
    value: 'Safe data shape',
    icon: 'rule',
    copy: 'Use options, constraints, and formats to keep CRM data consistent as the company scales.',
  },
]

function fieldHealth(def: CustomFieldDefinition): { score: number; gaps: string[] } {
  const needsOptions = def.type === 'dropdown' || def.type === 'multi_select'
  const hasConstraints = Boolean(def.minLength || def.maxLength || def.min != null || def.max != null || def.currencyCode)
  const checks = [
    { ok: Boolean(def.label?.trim()), label: 'label' },
    { ok: Boolean(def.key?.trim()), label: 'key' },
    { ok: Boolean(def.group?.trim()), label: 'group' },
    { ok: Boolean(def.helpText?.trim()), label: 'help text' },
    { ok: !needsOptions || Boolean(def.options?.length), label: 'options' },
    { ok: !['text', 'longtext', 'number', 'currency'].includes(def.type) || hasConstraints || Boolean(def.required), label: 'guardrail' },
  ]
  const passed = checks.filter((check) => check.ok).length
  return {
    score: Math.round((passed / checks.length) * 100),
    gaps: checks.filter((check) => !check.ok).map((check) => check.label),
  }
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CustomFieldsPage() {
  const [activeTab, setActiveTab] = useState<CustomFieldResource>('contact')
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all')

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingDef, setEditingDef] = useState<Partial<CustomFieldDefinition> | undefined>(undefined)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteDef, setPendingDeleteDef] = useState<CustomFieldDefinition | null>(null)

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
    setPendingDeleteDef(def)
  }

  function closeDeleteConfirmation() {
    if (deletingId) return
    setPendingDeleteDef(null)
  }

  async function confirmDelete() {
    if (!pendingDeleteDef) return
    const id = pendingDeleteDef.id
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
      setPendingDeleteDef(null)
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

  function clearFieldFilters() {
    setSearch('')
    setTypeFilter('')
    setReadinessFilter('all')
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const currentTab = TABS.find(t => t.resource === activeTab)!
  const requiredCount = definitions.filter((def) => def.required).length
  const groupedCount = definitions.filter((def) => def.group?.trim()).length
  const missingHelpCount = definitions.filter((def) => !def.helpText?.trim()).length
  const choiceCount = definitions.filter((def) => def.type === 'dropdown' || def.type === 'multi_select').length
  const constrainedCount = definitions.filter((def) => def.minLength || def.maxLength || def.min != null || def.max != null || def.currencyCode).length
  const readyCount = definitions.filter((def) => fieldHealth(def).score >= 80).length
  const needsWorkCount = definitions.length - readyCount
  const groupNames = Array.from(new Set(definitions.map((def) => def.group?.trim()).filter(Boolean))).sort()
  const typeOptions = Array.from(new Set(definitions.map((def) => def.type))).sort()
  const filteredDefinitions = definitions.filter((def) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q ||
      def.label.toLowerCase().includes(q) ||
      def.key.toLowerCase().includes(q) ||
      def.group?.toLowerCase().includes(q) ||
      def.helpText?.toLowerCase().includes(q)
    const matchesType = !typeFilter || def.type === typeFilter
    const health = fieldHealth(def)
    const matchesReadiness =
      readinessFilter === 'all' ||
      (readinessFilter === 'ready' && health.score >= 80) ||
      (readinessFilter === 'needs-work' && health.score < 80)
    return matchesSearch && matchesType && matchesReadiness
  })
  const hasFilters = Boolean(search) || Boolean(typeFilter) || readinessFilter !== 'all'

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Custom field command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Shape the extra contact, deal, and company data that powers qualification, reporting, segmentation, and handover quality.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
            New field
          </button>
        )}
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Schema fields" value={String(definitions.length)} sub={`${currentTab.label.toLowerCase()} records in this workspace`} icon="data_object" />
        <StatCard label="Required data" value={String(requiredCount)} sub={`${definitions.length - requiredCount} optional fields`} icon="rule" />
        <StatCard label="Field health" value={`${readyCount}/${definitions.length || 0}`} sub={`${needsWorkCount} field${needsWorkCount === 1 ? '' : 's'} need setup detail`} icon="monitoring" />
        <StatCard label="Data shape" value={String(groupNames.length)} sub={`${choiceCount} choice fields, ${constrainedCount} constrained`} icon="category" />
      </section>

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">info</span>
          Only admins can manage custom fields.
        </div>
      )}

      <PageTabs
        ariaLabel="Custom field resource"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CustomFieldResource)}
        tabs={TABS.map((tab) => ({ label: tab.label, value: tab.resource }))}
      />

      <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pib-input min-w-[220px] flex-1"
              placeholder="Search label, key, group, help..."
            />
            <select
              aria-label="Filter custom fields by type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="pib-input !w-auto"
            >
              <option value="">All types</option>
              {typeOptions.map((type) => (
                <option key={type} value={type} className="bg-black">{TYPE_LABELS[type]}</option>
              ))}
            </select>
            <select
              aria-label="Filter custom fields by health"
              value={readinessFilter}
              onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}
              className="pib-input !w-auto"
            >
              <option value="all">All health</option>
              <option value="ready">Ready</option>
              <option value="needs-work">Needs work</option>
            </select>
          </div>

          {hasFilters ? (
            <button
              type="button"
              onClick={() => { setSearch(''); setTypeFilter(''); setReadinessFilter('all') }}
              className="btn-pib-secondary text-xs inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">filter_alt_off</span>
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="bento-card !p-5 space-y-4">
          <div>
            <p className="eyebrow !text-[10px]">Schema focus</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              Healthy CRM fields have a clear group, help text, and guardrail so users know why the data matters.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
              <p className="font-display text-xl text-[var(--color-pib-text)]">{groupedCount}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Grouped</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
              <p className="font-display text-xl text-[var(--color-pib-text)]">{missingHelpCount}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">No help</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
              <p className="font-display text-xl text-[var(--color-pib-text)]">{choiceCount}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Choices</p>
            </div>
          </div>
          {hasFilters && isAdmin ? (
            <p className="text-xs text-amber-200">
              Reordering is available after filters are cleared so hidden fields keep their order.
            </p>
          ) : null}
        </div>
      </section>

      {/* Tab content */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-pib-text)]">
            Custom fields for {currentTab.label.toLowerCase()}s
          </h2>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            {filteredDefinitions.length} of {definitions.length} fields visible in this view.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-24" />)}
          </div>
        ) : fetchError ? (
          <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
            {fetchError}
          </div>
        ) : definitions.length === 0 ? (
          <div className="bento-card !p-0 overflow-hidden">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
              <div className="flex flex-col justify-between gap-8 border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
                <div>
                  <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                    <span className="material-symbols-outlined text-[22px]">data_object</span>
                  </span>
                  <p className="eyebrow !text-[10px]">Schema setup</p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-normal text-[var(--color-pib-text)]">
                    Design your first CRM data field
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    Start with the missing {currentTab.label.toLowerCase()} detail that would improve qualification, reporting, segmentation, or employee handover. A useful field has a clear group, help text, and a data guardrail before the team relies on it.
                  </p>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="cursor-pointer btn-pib-accent flex w-fit items-center gap-1.5 text-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                    Create the first {currentTab.label.toLowerCase()} field
                  </button>
                ) : (
                  <p className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                    Ask an admin to create the first {currentTab.label.toLowerCase()} field before teams standardise this schema.
                  </p>
                )}
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {FIELD_SETUP_BLUEPRINT.map((item) => (
                  <div key={item.label} className="rounded-xl border border-[var(--color-pib-line)] bg-black/10 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[var(--color-pib-text)]">
                        <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                      </span>
                      <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                        {item.value}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-[var(--color-pib-text)]">{item.label}</h4>
                    <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : filteredDefinitions.length === 0 ? (
          <div className="bento-card !p-8 text-center">
            <span className="material-symbols-outlined text-[34px] text-[var(--color-pib-text-muted)] mb-3 block" aria-hidden="true">search_off</span>
            <p className="eyebrow !text-[10px]">Filtered schema view</p>
            <h3 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">No fields match this view.</h3>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Clear the field filters to return to the full CRM schema.</p>
            <button
              type="button"
              onClick={clearFieldFilters}
              className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5 text-xs"
              aria-label="Show all fields"
            >
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">filter_alt_off</span>
              Show all fields
            </button>
          </div>
        ) : (
          <CustomFieldDefinitionsList
            definitions={filteredDefinitions}
            isAdmin={isAdmin}
            canReorder={isAdmin && !hasFilters}
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

      {pendingDeleteDef && (
        <section
          role="alertdialog"
          aria-labelledby="delete-field-title"
          aria-describedby="delete-field-description"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl rounded-lg border border-red-400/30 bg-[var(--color-pib-surface)] p-4 shadow-2xl md:bottom-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-300" aria-hidden="true">
                warning
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-red-200">Schema delete confirmation</p>
                <h2 id="delete-field-title" className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                  Delete custom field &quot;{pendingDeleteDef.label}&quot;?
                </h2>
                <p id="delete-field-description" className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
                  This removes the field from future {currentTab.label.toLowerCase()} records and schema views. Existing saved values may remain in historical records for audit and cleanup.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={closeDeleteConfirmation}
                className="btn-pib-secondary text-xs"
                disabled={deletingId === pendingDeleteDef.id}
                aria-label={`Cancel delete for custom field ${pendingDeleteDef.label}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
                disabled={deletingId === pendingDeleteDef.id}
                aria-label={`Confirm delete custom field ${pendingDeleteDef.label}`}
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  delete
                </span>
                {deletingId === pendingDeleteDef.id ? 'Deleting...' : 'Delete field'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
