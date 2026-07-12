// app/(portal)/portal/settings/custom-fields/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CustomFieldDefinitionsList } from '@/components/crm/CustomFieldDefinitionsList'
import { CustomFieldDefinitionDrawer } from '@/components/crm/CustomFieldDefinitionDrawer'
import { PageTabs } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
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

function fieldDisplayName(def: CustomFieldDefinition): string {
  return def.label?.trim() || 'Field label missing'
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">{label}</p>
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant">{icon}</span>
      </div>
      <p className="mt-1 text-lg font-semibold leading-none text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">{sub}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CustomFieldsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const customFieldEndpoint = useCallback(
    (path: string) => scopedApiPath(path, orgScope),
    [orgScope],
  )
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
      const res = await fetch(customFieldEndpoint(`/api/v1/crm/custom-fields?resource=${resource}`))
      const body = await res.json().catch(() => ({}))
      if (res.status === 404) {
        setFetchError('Custom fields API is not yet available. It will be ready shortly.')
        setDefinitions([])
        return
      }
      if (!res.ok) {
        setFetchError(typeof body?.error === 'string' ? body.error : 'Failed to load custom fields. Please try again.')
        setDefinitions([])
        return
      }
      const defs: CustomFieldDefinition[] = body.data?.definitions ?? body.definitions ?? []
      setDefinitions(defs)
    } catch {
      setFetchError('Could not reach the server. Check your connection.')
      setDefinitions([])
    } finally {
      setLoading(false)
    }
  }, [customFieldEndpoint])

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
      const res = await fetch(customFieldEndpoint(`/api/v1/crm/custom-fields/${id}`), { method: 'DELETE' })
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
      const res = await fetch(customFieldEndpoint('/api/v1/crm/custom-fields/reorder'), {
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
      ? customFieldEndpoint(`/api/v1/crm/custom-fields/${editingDef!.id}`)
      : customFieldEndpoint('/api/v1/crm/custom-fields')
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
    <div className="space-y-2">
      <header className="flex h-11 items-center gap-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3">
        <span className="material-symbols-outlined grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[15px] text-primary" aria-hidden="true">data_object</span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">CRM settings</p>
          <h1 className="truncate text-sm font-semibold leading-tight text-on-surface">Custom field command center</h1>
        </div>
        <p className="ml-2 hidden min-w-0 truncate text-xs text-on-surface-variant lg:block">
          Shape the extra contact, deal, and company data that powers qualification, reporting, segmentation, and handover quality.
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="ml-auto flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
            New field
          </button>
        )}
      </header>

      {!fetchError && (
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Schema fields" value={String(definitions.length)} sub={`${currentTab.label.toLowerCase()} records in this workspace`} icon="data_object" />
          <StatCard label="Required data" value={String(requiredCount)} sub={`${definitions.length - requiredCount} optional fields`} icon="rule" />
          <StatCard label="Field health" value={`${readyCount}/${definitions.length || 0}`} sub={`${needsWorkCount} field${needsWorkCount === 1 ? '' : 's'} need setup detail`} icon="monitoring" />
          <StatCard label="Data shape" value={String(groupNames.length)} sub={`${choiceCount} choice fields, ${constrainedCount} constrained`} icon="category" />
        </section>
      )}

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3 py-2 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">info</span>
          Only admins can manage custom fields.
        </div>
      )}

      {!fetchError && (
        <PageTabs
          ariaLabel="Custom field resource"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CustomFieldResource)}
          tabs={TABS.map((tab) => ({ label: tab.label, value: tab.resource }))}
        />
      )}

      {!fetchError && (
        <section className="grid gap-2 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/65 px-2 py-1.5">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 min-w-[220px] flex-1 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface placeholder:text-on-surface-variant"
                placeholder="Search label, key, group, help..."
              />
              <select
                aria-label="Filter custom fields by type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-8 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
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
                className="h-8 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
              >
                <option value="all">All health</option>
                <option value="ready">Ready</option>
                <option value="needs-work">Needs work</option>
              </select>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setTypeFilter(''); setReadinessFilter('all') }}
                  className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">filter_alt_off</span>
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
            <div>
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Schema focus</p>
              <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                Healthy CRM fields have a clear group, help text, and guardrail so users know why the data matters.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className="text-lg font-semibold text-on-surface">{groupedCount}</p>
                <p className="text-[11px] leading-4 text-on-surface-variant">Grouped</p>
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className="text-lg font-semibold text-on-surface">{missingHelpCount}</p>
                <p className="text-[11px] leading-4 text-on-surface-variant">No help</p>
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className="text-lg font-semibold text-on-surface">{choiceCount}</p>
                <p className="text-[11px] leading-4 text-on-surface-variant">Choices</p>
              </div>
            </div>
            {hasFilters && isAdmin ? (
              <p className="text-[11px] text-amber-200">
                Reordering is available after filters are cleared so hidden fields keep their order.
              </p>
            ) : null}
          </div>
        </section>
      )}

      {/* Tab content */}
      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-xs font-semibold text-on-surface">
            Custom fields for {currentTab.label.toLowerCase()}s
          </h2>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">
            {filteredDefinitions.length} of {definitions.length} fields visible in this view.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-20" />)}
          </div>
        ) : fetchError ? (
          <section className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-2">
                <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-200" aria-hidden="true">warning</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-label uppercase tracking-[0.22em] text-amber-200">Source health</p>
                  <h2 className="mt-0.5 text-sm font-semibold text-on-surface">
                    Custom field schema could not load
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-on-surface-variant">{fetchError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => fetchDefs(activeTab)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                aria-label="Retry loading custom field schema"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                Retry
              </button>
            </div>
          </section>
        ) : definitions.length === 0 ? (
          <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
              <div className="flex flex-col justify-between gap-4 border-b border-[var(--color-card-border)] p-4 lg:border-b-0 lg:border-r">
                <div>
                  <span className="mb-2 grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-[15px]">data_object</span>
                  </span>
                  <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Schema setup</p>
                  <h3 className="mt-1 text-base font-semibold text-on-surface">
                    Design your first CRM data field
                  </h3>
                  <p className="mt-2 max-w-xl text-xs leading-5 text-on-surface-variant">
                    Start with the missing {currentTab.label.toLowerCase()} detail that would improve qualification, reporting, segmentation, or employee handover. A useful field has a clear group, help text, and a data guardrail before the team relies on it.
                  </p>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="flex h-8 w-fit cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                    Create the first {currentTab.label.toLowerCase()} field
                  </button>
                ) : (
                  <p className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2.5 py-1.5 text-[11px] text-on-surface-variant">
                    Ask an admin to create the first {currentTab.label.toLowerCase()} field before teams standardise this schema.
                  </p>
                )}
              </div>

              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {FIELD_SETUP_BLUEPRINT.map((item) => (
                  <div key={item.label} className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-2.5">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.04] text-on-surface">
                        <span className="material-symbols-outlined text-[15px]">{item.icon}</span>
                      </span>
                      <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] text-on-surface-variant">
                        {item.value}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-on-surface">{item.label}</h4>
                    <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">{item.copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : filteredDefinitions.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-6 text-center">
            <span className="material-symbols-outlined mb-2 block text-[19px] text-on-surface-variant" aria-hidden="true">search_off</span>
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Filtered schema view</p>
            <h3 className="mt-1 text-sm font-semibold text-on-surface">No fields match this view.</h3>
            <p className="mt-1 text-xs text-on-surface-variant">Clear the field filters to return to the full CRM schema.</p>
            <button
              type="button"
              onClick={clearFieldFilters}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
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
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl rounded-xl border border-red-400/40 bg-[var(--color-card)] p-3 md:bottom-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-red-300" aria-hidden="true">
                warning
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-red-200">Schema delete confirmation</p>
                <h2 id="delete-field-title" className="mt-0.5 text-sm font-semibold text-on-surface">
                  Delete custom field &quot;{fieldDisplayName(pendingDeleteDef)}&quot;?
                </h2>
                <p id="delete-field-description" className="mt-1 max-w-3xl text-xs leading-5 text-on-surface-variant">
                  This removes the field from future {currentTab.label.toLowerCase()} records and schema views. Existing saved values may remain in historical records for audit and cleanup.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={closeDeleteConfirmation}
                className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                disabled={deletingId === pendingDeleteDef.id}
                aria-label={`Cancel delete for custom field ${fieldDisplayName(pendingDeleteDef)}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 px-2 text-xs font-semibold text-red-100 transition hover:bg-red-400/20 disabled:opacity-50"
                disabled={deletingId === pendingDeleteDef.id}
                aria-label={`Confirm delete custom field ${fieldDisplayName(pendingDeleteDef)}`}
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
