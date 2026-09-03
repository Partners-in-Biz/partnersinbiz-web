// app/(portal)/portal/settings/custom-fields/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { Icon } from '@/components/studio'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CustomFieldDefinitionsList } from '@/components/crm/CustomFieldDefinitionsList'
import { CustomFieldDefinitionDrawer } from '@/components/crm/CustomFieldDefinitionDrawer'
import { PageTabs, PageHeader} from '@/components/ui/AppFoundation'
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
    <div className="pib-stat-card min-w-0" data-module-accent="cyan">
      <div className="flex items-start justify-between gap-2">
        <p className="pib-label">{label}</p>
        <Icon name={icon} />
      </div>
      <p className="mt-2 text-2xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{sub}</p>
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
    <div className="space-y-6">
      <PageHeader
        accent="cyan"
        eyebrow="CRM settings"
        title="Custom field command center"
        description="Shape the extra contact, deal, and company data that powers qualification, reporting, segmentation, and handover quality."
        actions={isAdmin ? (
          <button
            type="button"
            onClick={openCreate}
            className="btn-pib-primary btn-pib-sm shrink-0"
          >
            <Icon name="add" />
            New field
          </button>
        ) : undefined}
      />

      {!fetchError && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Schema fields" value={String(definitions.length)} sub={`${currentTab.label.toLowerCase()} records in this workspace`} icon="data_object" />
          <StatCard label="Required data" value={String(requiredCount)} sub={`${definitions.length - requiredCount} optional fields`} icon="rule" />
          <StatCard label="Field health" value={`${readyCount}/${definitions.length || 0}`} sub={`${needsWorkCount} field${needsWorkCount === 1 ? '' : 's'} need setup detail`} icon="monitoring" />
          <StatCard label="Data shape" value={String(groupNames.length)} sub={`${choiceCount} choice fields, ${constrainedCount} constrained`} icon="category" />
        </section>
      )}

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="pib-card flex items-center gap-2 !py-3 text-xs text-[var(--color-pib-text-muted)]">
          <Icon name="info" />
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
        <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search custom fields"
                  className="pib-input min-w-[220px] flex-1"
                placeholder="Search label, key, group, help..."
              />
              <select
                aria-label="Filter custom fields by type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="pib-select w-auto"
              >
                <option value="">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
              <select
                aria-label="Filter custom fields by health"
                value={readinessFilter}
                onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}
                className="pib-select w-auto"
              >
                <option value="all">All health</option>
                <option value="ready">Ready</option>
                <option value="needs-work">Needs work</option>
              </select>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setTypeFilter(''); setReadinessFilter('all') }}
                  className="btn-pib-ghost"
                >
                  <Icon name="filter_alt_off" />
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="pib-card space-y-4">
            <div>
              <p className="pib-label">Schema focus</p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Healthy CRM fields have a clear group, help text, and guardrail so users know why the data matters.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-[var(--color-pib-line)] px-2 py-2">
                <p className="text-lg text-[var(--color-pib-text)]">{groupedCount}</p>
                <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Grouped</p>
              </div>
              <div className="rounded border border-[var(--color-pib-line)] px-2 py-2">
                <p className="text-lg text-[var(--color-pib-text)]">{missingHelpCount}</p>
                <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">No help</p>
              </div>
              <div className="rounded border border-[var(--color-pib-line)] px-2 py-2">
                <p className="text-lg text-[var(--color-pib-text)]">{choiceCount}</p>
                <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Choices</p>
              </div>
            </div>
            {hasFilters && isAdmin ? (
              <p className="text-[11px] text-[var(--color-pib-accent)]">
                Reordering is available after filters are cleared so hidden fields keep their order.
              </p>
            ) : null}
          </div>
        </section>
      )}

      {/* Tab content */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm text-[var(--color-pib-text)]">
            Custom fields for {currentTab.label.toLowerCase()}s
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-pib-text-muted)]">
            {filteredDefinitions.length} of {definitions.length} fields visible in this view.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-20" />)}
          </div>
        ) : fetchError ? (
          <section className="pib-card">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <Icon name="warning" />
                <div className="min-w-0">
                  <p className="pib-label">Source health</p>
                  <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                    Custom field schema could not load
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{fetchError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => fetchDefs(activeTab)}
                className="btn-pib-secondary shrink-0"
                aria-label="Retry loading custom field schema"
              >
                <Icon name="refresh" />
                Retry
              </button>
            </div>
          </section>
        ) : definitions.length === 0 ? (
          <div className="pib-card overflow-hidden !p-0">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
              <div className="flex flex-col justify-between gap-6 border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
                <div>
                  <Icon name="data_object" />
                  <p className="pib-label">Schema setup</p>
                  <h3 className="mt-1 text-base text-[var(--color-pib-text)]">
                    Design your first CRM data field
                  </h3>
                  <p className="mt-2 max-w-xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                    Start with the missing {currentTab.label.toLowerCase()} detail that would improve qualification, reporting, segmentation, or employee handover. A useful field has a clear group, help text, and a data guardrail before the team relies on it.
                  </p>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="btn-pib-primary w-fit"
                  >
                    <Icon name="add" />
                    Create the first {currentTab.label.toLowerCase()} field
                  </button>
                ) : (
                  <p className="rounded border border-[var(--color-pib-line)] px-2.5 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
                    Ask an admin to create the first {currentTab.label.toLowerCase()} field before teams standardise this schema.
                  </p>
                )}
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {FIELD_SETUP_BLUEPRINT.map((item) => (
                  <div key={item.label} className="pib-card min-w-0 !p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="shrink-0">
                        <Icon name={item.icon} />
                      </span>
                      <span className="pib-pill pib-pill-cyan">
                        {item.value}
                      </span>
                    </div>
                    <h4 className="text-xs text-[var(--color-pib-text)]">{item.label}</h4>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{item.copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : filteredDefinitions.length === 0 ? (
          <div className="pib-empty-state">
            <Icon name="search_off" />
            <p className="pib-label">Filtered schema view</p>
            <h3 className="pib-empty-state-title">No fields match this view.</h3>
            <p className="pib-empty-state-description">Clear the field filters to return to the full CRM schema.</p>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={clearFieldFilters}
                className="btn-pib-secondary"
                aria-label="Show all fields"
              >
                <Icon name="filter_alt_off" />
                Show all fields
              </button>
            </div>
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
          className="pib-card fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl border-[var(--color-pib-line-strong)] md:bottom-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <Icon name="warning" />
              <div className="min-w-0">
                <p className="pib-label">Schema delete confirmation</p>
                <h2 id="delete-field-title" className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                  Delete custom field &quot;{fieldDisplayName(pendingDeleteDef)}&quot;?
                </h2>
                <p id="delete-field-description" className="mt-1 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  This removes the field from future {currentTab.label.toLowerCase()} records and schema views. Existing saved values may remain in historical records for audit and cleanup.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={closeDeleteConfirmation}
                className="btn-pib-ghost"
                disabled={deletingId === pendingDeleteDef.id}
                aria-label={`Cancel delete for custom field ${fieldDisplayName(pendingDeleteDef)}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="btn-pib-danger"
                disabled={deletingId === pendingDeleteDef.id}
                aria-label={`Confirm delete custom field ${fieldDisplayName(pendingDeleteDef)}`}
              >
                <Icon name="delete" />
                {deletingId === pendingDeleteDef.id ? 'Deleting...' : 'Delete field'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
