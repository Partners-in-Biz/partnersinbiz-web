'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DealDetailDrawer } from '@/components/crm/DealDetailDrawer'
import { DealDrawer } from '@/components/crm/DealDrawer'
import { DealKanban } from '@/components/crm/DealKanban'
import { PipelineSelector } from '@/components/crm/PipelineSelector'
import { EmptyState, PageHeader, PageTabs } from '@/components/ui/AppFoundation'
import type { Contact, Currency, Deal } from '@/lib/crm/types'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

type ViewMode = 'board' | 'list' | 'forecast' | 'contacts'

type TeamMember = {
  uid: string
  firstName?: string
  lastName?: string
  displayName?: string
  email?: string
  jobTitle?: string
  role?: string
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function timestampMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function formatRelative(value: unknown): string {
  const ms = timestampMs(value)
  if (!ms) return 'Never'
  const diffDays = Math.round((Date.now() - ms) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays}d ago`
}

function fmtDealValue(value: number | undefined, currency?: string) {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency ?? 'ZAR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency ?? 'ZAR'} ${amount.toFixed(0)}`
  }
}

function formatDealsTotal(deals: Deal[], mode: 'value' | 'weighted') {
  const total = deals.reduce((sum, deal) => {
    if (mode === 'weighted') return sum + (deal.value ?? 0) * ((deal.probability ?? 50) / 100)
    return sum + (deal.value ?? 0)
  }, 0)
  return fmtDealValue(total, deals.find((deal) => deal.currency)?.currency)
}

function hasDealOwner(deal: Deal): boolean {
  return Boolean(String(deal.ownerUid ?? deal.ownerRef?.uid ?? '').trim())
}

function dealOwnerLabel(deal: Deal): string {
  return deal.ownerRef?.displayName || deal.ownerUid || 'Unassigned'
}

function teamMemberLabel(member: TeamMember): string {
  const name = member.displayName || [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email || member.uid
  return member.jobTitle ? `${name} - ${member.jobTitle}` : name
}

function teamMemberDisplayName(member: TeamMember): string {
  return member.displayName || [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email || member.uid
}

function teamMemberOwnerRef(member: TeamMember) {
  return {
    uid: member.uid,
    displayName: teamMemberDisplayName(member),
    ...(member.jobTitle ? { jobTitle: member.jobTitle } : {}),
    kind: 'human' as const,
  }
}

function contactEmailLabel(contact: Contact): string {
  return contact.email?.trim() || 'Email missing'
}

function contactCompanyLabel(contact: Contact): string {
  return contact.companyName?.trim() || contact.company?.trim() || 'Company missing'
}

function dealCompanyLabel(deal: Deal): string {
  return deal.companyName?.trim() || 'Company missing'
}

async function readApiJson(res: Response, fallback: string) {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `${fallback} (${res.status})`
    throw new Error(message)
  }
  return body
}

function stageColorByKind(kind?: PipelineStage['kind']): string {
  if (kind === 'won') return '#4ade80'
  if (kind === 'lost') return '#ef4444'
  return '#60a5fa'
}

function PipelineMetric({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub: string
  icon: string
}) {
  return (
    <div className="pib-card min-w-[150px] flex-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
        <span className="material-symbols-outlined text-[17px] text-on-surface-variant">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-headline font-bold leading-none text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] text-on-surface-variant">{sub}</p>
    </div>
  )
}

function ProbabilityInput({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, probability: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(deal.probability ?? 50))

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="w-full text-right hover:underline">
        {deal.probability ?? 50}%
      </button>
    )
  }

  return (
    <input
      autoFocus
      type="number"
      min={0}
      max={100}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = Math.max(0, Math.min(100, Number(value)))
        onUpdate(deal.id, next)
        setEditing(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="w-16 rounded border border-[var(--color-pib-accent)] bg-transparent px-2 py-1 text-right"
    />
  )
}

export default function PipelinePage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [pipelinesLoading, setPipelinesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [ownerLens, setOwnerLens] = useState<'all' | 'unassigned'>('all')
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set())
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [bulkOwnerUid, setBulkOwnerUid] = useState('')
  const [bulkOwnerPending, setBulkOwnerPending] = useState(false)
  const [bulkOwnerError, setBulkOwnerError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [showCreateDrawer, setShowCreateDrawer] = useState(false)
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [viewingDeal, setViewingDeal] = useState<Deal | null>(null)

  useEffect(() => {
    let cancelled = false
    setPipelinesLoading(true)
    fetch('/api/v1/crm/pipelines')
      .then((res) => readApiJson(res, 'Failed to load pipelines'))
      .then((body) => {
        if (cancelled) return
        const list = extractPipelinesList(body)
        setPipelines(list)
        const defaultPipeline = list.find((pipeline) => pipeline.isDefault) ?? list[0]
        if (defaultPipeline) setSelectedPipelineId(defaultPipeline.id)
        setPipelinesLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load pipelines')
        setPipelinesLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setContactsLoading(true)
    fetch('/api/v1/crm/contacts?limit=200')
      .then((res) => readApiJson(res, 'Failed to load contacts'))
      .then((body) => {
        if (cancelled) return
        setContacts(Array.isArray(body.data) ? body.data : [])
        setContactsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setContacts([])
        setContactsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/portal/settings/team')
      .then((res) => res.ok ? res.json() : null)
      .then((body) => {
        if (cancelled) return
        const members = Array.isArray(body?.members) ? body.members : []
        setTeamMembers(members.filter((member: TeamMember) => member.uid))
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([])
      })
    return () => { cancelled = true }
  }, [])

  const fetchDeals = useCallback(async (pipelineId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(pipelineId)}&limit=300`)
      const body = await readApiJson(res, 'Failed to load deals')
      setDeals(Array.isArray(body.data) ? body.data : [])
      setStageFilter('all')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deals')
      setDeals([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedPipelineId) {
      setDeals([])
      setLoading(false)
      return
    }
    void fetchDeals(selectedPipelineId)
  }, [fetchDeals, selectedPipelineId])

  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId)
  const stages = useMemo<PipelineStage[]>(
    () => selectedPipeline ? [...selectedPipeline.stages].sort((a, b) => a.order - b.order) : [],
    [selectedPipeline],
  )

  const lostStageIds = useMemo(() => new Set(stages.filter((stage) => stage.kind === 'lost').map((stage) => stage.id)), [stages])
  const wonStageIds = useMemo(() => new Set(stages.filter((stage) => stage.kind === 'won').map((stage) => stage.id)), [stages])

  const contactLabelsById = useMemo(() => {
    return contacts.reduce<Record<string, string>>((acc, contact) => {
      const label = contact.name?.trim() || contact.email?.trim()
      if (label) acc[contact.id] = label
      return acc
    }, {})
  }, [contacts])

  const searchedDeals = useMemo(() => {
    const query = search.trim().toLowerCase()
    return deals.filter((deal) => {
      const contactLabel = contactLabelsById[deal.contactId]
      const matchesSearch = !query ||
        deal.title.toLowerCase().includes(query) ||
        deal.companyName?.toLowerCase().includes(query) ||
        deal.contactId?.toLowerCase().includes(query) ||
        contactLabel?.toLowerCase().includes(query)
      const matchesStage = stageFilter === 'all' || deal.stageId === stageFilter
      const matchesOwnerLens = ownerLens === 'all' || !hasDealOwner(deal)
      return matchesSearch && matchesStage && matchesOwnerLens
    })
  }, [contactLabelsById, deals, ownerLens, search, stageFilter])

  useEffect(() => {
    setSelectedDealIds((current) => {
      if (current.size === 0) return current
      const visibleIds = new Set(searchedDeals.map((deal) => deal.id))
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [searchedDeals])

  const openDeals = useMemo(() => deals
    .filter((deal) => !lostStageIds.has(deal.stageId) && !wonStageIds.has(deal.stageId))
    .slice()
    .sort((a, b) => {
      const aMs = timestampMs(a.expectedCloseDate)
      const bMs = timestampMs(b.expectedCloseDate)
      if (!aMs && !bMs) return 0
      if (!aMs) return 1
      if (!bMs) return -1
      return aMs - bMs
    }), [deals, lostStageIds, wonStageIds])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return contacts.filter((contact) => {
      if (!query) return true
      return (
        contact.name?.toLowerCase().includes(query) ||
        contact.email?.toLowerCase().includes(query) ||
        contact.company?.toLowerCase().includes(query) ||
        contact.companyName?.toLowerCase().includes(query)
      )
    })
  }, [contacts, search])

  const metrics = useMemo(() => {
    const primaryCurrency: Currency = deals.find((deal) => deal.currency)?.currency ?? 'ZAR'
    const total = deals.filter((deal) => !lostStageIds.has(deal.stageId)).reduce((sum, deal) => sum + (deal.value ?? 0), 0)
    const weighted = deals.filter((deal) => !lostStageIds.has(deal.stageId)).reduce((sum, deal) => {
      const stage = stages.find((item) => item.id === deal.stageId)
      const probability = deal.probability ?? stage?.probability ?? 50
      return sum + (deal.value ?? 0) * (probability / 100)
    }, 0)
    const won = deals.filter((deal) => wonStageIds.has(deal.stageId)).reduce((sum, deal) => sum + (deal.value ?? 0), 0)
    const assignedDeals = deals.filter(hasDealOwner).length
    const unassignedDeals = deals.length - assignedDeals
    const staleContacts = contacts.filter((contact) => {
      const ms = timestampMs(contact.lastContactedAt)
      if (!ms) return true
      return Date.now() - ms > 14 * 86_400_000
    }).length
    return {
      primaryCurrency,
      total,
      weighted,
      won,
      open: openDeals.length,
      totalDeals: deals.length,
      ownerCoverage: deals.length ? Math.round((assignedDeals / deals.length) * 100) : 100,
      unassignedDeals,
      contacts: contacts.length,
      staleContacts,
    }
  }, [contacts, deals, lostStageIds, openDeals.length, stages, wonStageIds])

  const handleStageChange = useCallback(async (dealId: string, newStageId: string) => {
    const res = await fetch(`/api/v1/crm/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to update deal stage')
    }
    setDeals((prev) => prev.map((deal) => deal.id === dealId ? { ...deal, stageId: newStageId } : deal))
  }, [])

  const handlePipelineChange = useCallback((id: string) => {
    setSelectedPipelineId(id)
    setDeals([])
    setError(null)
  }, [])

  const handleDealSaved = useCallback(() => {
    setShowCreateDrawer(false)
    setEditingDeal(null)
    setViewingDeal(null)
    if (selectedPipelineId) void fetchDeals(selectedPipelineId)
  }, [fetchDeals, selectedPipelineId])

  const handleProbabilityUpdate = useCallback(async (dealId: string, probability: number) => {
    setDeals((prev) => prev.map((deal) => deal.id === dealId ? { ...deal, probability } : deal))
    await fetch(`/api/v1/crm/deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probability }),
    }).catch(() => undefined)
  }, [])

  function toggleDealSelection(id: string) {
    setSelectedDealIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleVisibleDeals() {
    const visibleIds = searchedDeals.map((deal) => deal.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedDealIds.has(id))
    if (allVisibleSelected) {
      setSelectedDealIds((current) => {
        const next = new Set(current)
        for (const id of visibleIds) next.delete(id)
        return next
      })
    } else {
      setSelectedDealIds((current) => new Set([...current, ...visibleIds]))
    }
  }

  async function assignSelectedDealOwner() {
    const ownerUid = bulkOwnerUid.trim()
    if (!ownerUid || selectedDealIds.size === 0) return
    const owner = teamMembers.find((member) => member.uid === ownerUid)

    setBulkOwnerPending(true)
    setBulkOwnerError('')
    try {
      const ids = Array.from(selectedDealIds)
      await Promise.all(ids.map(async (dealId) => {
        const res = await fetch(`/api/v1/crm/deals/${dealId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerUid }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to assign deal owner')
        }
      }))
      setDeals((current) => current.map((deal) => (
        selectedDealIds.has(deal.id)
          ? {
              ...deal,
              ownerUid,
              ownerRef: owner ? teamMemberOwnerRef(owner) : deal.ownerRef,
            }
          : deal
      )))
      setSelectedDealIds(new Set())
      setBulkOwnerUid('')
      setOwnerLens('all')
    } catch (err) {
      setBulkOwnerError(err instanceof Error ? err.message : 'Failed to assign deal owner')
    } finally {
      setBulkOwnerPending(false)
    }
  }

  const ready = !pipelinesLoading && !loading

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin CRM / Pipeline"
        title="Pipeline command center"
        description="Work deals, forecast revenue, spot follow-up risk, and move opportunities through the active sales process."
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-3">
            {pipelines.length > 0 && (
              <PipelineSelector
                pipelines={pipelines}
                selectedId={selectedPipelineId}
                onChange={handlePipelineChange}
                className="w-56"
              />
            )}
            <Link href="/admin/crm/contacts" className="pib-btn-secondary text-sm">
              <span className="material-symbols-outlined text-base">contacts</span>
              Contacts
            </Link>
            <button onClick={() => setShowCreateDrawer(true)} className="pib-btn-primary text-sm">
              <span className="material-symbols-outlined text-base">add</span>
              New deal
            </button>
          </div>
        )}
      />

      {ready && !error && (
        <section className="flex flex-wrap gap-3">
          <PipelineMetric icon="paid" label="Pipeline value" value={fmtDealValue(metrics.total, metrics.primaryCurrency)} sub="Excluding lost deals" />
          <PipelineMetric icon="trending_up" label="Weighted forecast" value={fmtDealValue(metrics.weighted, metrics.primaryCurrency)} sub="Probability adjusted" />
          <PipelineMetric icon="emoji_events" label="Won value" value={fmtDealValue(metrics.won, metrics.primaryCurrency)} sub="Current loaded pipeline" />
          <PipelineMetric icon="view_kanban" label="Open deals" value={String(metrics.open)} sub={`${metrics.totalDeals} total deals`} />
          <PipelineMetric icon="supervisor_account" label="Deal owner coverage" value={`${metrics.ownerCoverage}%`} sub={`${metrics.unassignedDeals} unassigned`} />
          <PipelineMetric icon="schedule" label="Follow-up risk" value={String(metrics.staleContacts)} sub={`${metrics.contacts} contacts loaded`} />
        </section>
      )}

      {ready && !error && (
        <section className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <button
            type="button"
            onClick={() => setOwnerLens(ownerLens === 'unassigned' ? 'all' : 'unassigned')}
            className={[
              'rounded-[var(--radius-card)] border p-4 text-left transition-colors',
              ownerLens === 'unassigned'
                ? 'border-amber-400/40 bg-amber-400/10'
                : 'border-[var(--color-pib-line)] bg-white/[0.03] hover:bg-white/[0.05]',
            ].join(' ')}
            aria-label={ownerLens === 'unassigned' ? 'Show all admin deals' : 'Show unassigned admin deals needing an owner'}
          >
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">manage_accounts</span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">
              {ownerLens === 'unassigned' ? 'Showing unassigned deals' : 'Review unassigned deals'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              {metrics.unassignedDeals > 0
                ? `${metrics.unassignedDeals} deals need an owner before internal forecast and handoff accountability can be trusted.`
                : 'Every loaded deal has an owner.'}
            </p>
          </button>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">assignment_ind</span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">Admin pipeline ownership</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              Use the lens with row selection to assign sales responsibility before revenue reviews or client handoffs.
            </p>
          </div>
        </section>
      )}

      <PageTabs
        ariaLabel="Pipeline view mode"
        value={viewMode}
        onValueChange={(value) => {
          setViewMode(value as ViewMode)
          setStageFilter('all')
        }}
        variant="segmented"
        tabs={[
          { value: 'board', label: 'Board', icon: 'view_kanban' },
          { value: 'list', label: 'List', icon: 'list' },
          { value: 'forecast', label: 'Forecast', icon: 'trending_up' },
          { value: 'contacts', label: 'Contact signals', icon: 'groups' },
        ]}
      />

      <div className="pib-card flex flex-wrap items-center gap-3 p-4">
        <input
          type="text"
          placeholder={viewMode === 'contacts' ? 'Search contacts...' : 'Search deals, company, contact id...'}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pib-input min-w-[260px] flex-1"
        />
        {viewMode !== 'contacts' && stages.length > 0 && (
          <>
            {(['all', ...stages.map((stage) => stage.id)] as const).map((stageId) => {
              const stage = stages.find((item) => item.id === stageId)
              return (
                <button
                  key={stageId}
                  onClick={() => setStageFilter(stageId)}
                  className={[
                    'rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-label capitalize transition-colors',
                    stageFilter === stageId
                      ? 'font-medium text-black'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                  ].join(' ')}
                  style={stageFilter === stageId ? { background: 'var(--color-accent-v2)' } : {}}
                >
                  {stageId === 'all' ? 'All stages' : stage?.label ?? stageId}
                </button>
              )
            })}
          </>
        )}
      </div>

      {ready && !error && selectedDealIds.size > 0 && (
        <section className="pib-card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="adminDealBulkOwner" className="pib-label">Assign selected admin deals to owner</label>
            <select
              id="adminDealBulkOwner"
              value={bulkOwnerUid}
              onChange={(event) => setBulkOwnerUid(event.target.value)}
              className="pib-select mt-1"
            >
              <option value="">Select a team member</option>
              {teamMembers.map((member) => (
                <option key={member.uid} value={member.uid}>
                  {teamMemberLabel(member)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={assignSelectedDealOwner}
            disabled={!bulkOwnerUid.trim() || bulkOwnerPending}
            className="pib-btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Assign owner to ${selectedDealIds.size} selected admin deal${selectedDealIds.size === 1 ? '' : 's'}`}
          >
            <span className="material-symbols-outlined text-base">supervisor_account</span>
            {bulkOwnerPending ? 'Assigning...' : 'Assign owner'}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedDealIds(new Set()); setBulkOwnerUid(''); setBulkOwnerError('') }}
            className="pib-btn-secondary text-sm"
          >
            Clear selection
          </button>
          <p className="basis-full text-xs text-on-surface-variant">
            {selectedDealIds.size} selected for owner assignment.
          </p>
          {bulkOwnerError && <p className="basis-full text-xs text-red-300">{bulkOwnerError}</p>}
        </section>
      )}

      {error && (
        <EmptyState icon="error" title="Unable to load pipeline." description={error} />
      )}

      {!error && viewMode === 'board' && (
        stages.length === 0 && pipelinesLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex w-64 shrink-0 flex-col gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ))}
          </div>
        ) : loading ? (
          <DealKanban
            deals={[]}
            stages={stages}
            loading
            onStageChange={handleStageChange}
            contactBasePath="/admin/crm/contacts"
            contactLabelsById={contactLabelsById}
          />
        ) : searchedDeals.length === 0 ? (
          <EmptyState
            icon="monetization_on"
            title="No deals in this view."
            description="Create a deal or clear filters to return to the full pipeline."
            action={(
              <button onClick={() => setShowCreateDrawer(true)} className="pib-btn-primary inline-flex text-sm">
                <span className="material-symbols-outlined text-base">add</span>
                New deal
              </button>
            )}
          />
        ) : (
          <DealKanban
            deals={searchedDeals}
            stages={stages}
            onStageChange={handleStageChange}
            contactBasePath="/admin/crm/contacts"
            contactLabelsById={contactLabelsById}
          />
        )
      )}

      {!error && viewMode === 'list' && (
        loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : searchedDeals.length === 0 ? (
          <EmptyState icon="search_off" title="No deals found." description="Try another filter or create a new opportunity." />
        ) : (
          <div className="pib-card-section overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-card-border)] bg-white/[0.02]">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select visible admin deals for owner assignment"
                      checked={searchedDeals.length > 0 && searchedDeals.every((deal) => selectedDealIds.has(deal.id))}
                      onChange={toggleVisibleDeals}
                      className="h-4 w-4 rounded border-[var(--color-pib-line)] bg-transparent"
                    />
                  </th>
                  {['Deal', 'Stage', 'Owner', 'Value', 'Prob', 'Weighted', 'Company', 'Contact'].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {searchedDeals.map((deal) => {
                  const stage = stages.find((item) => item.id === deal.stageId)
                  const contactLabel = contactLabelsById[deal.contactId]
                  const color = stage?.color ?? stageColorByKind(stage?.kind)
                  const probability = deal.probability ?? stage?.probability ?? 50
                  const weighted = (deal.value ?? 0) * (probability / 100)
                  return (
                    <tr
                      key={deal.id}
                      data-admin-deal-row
                      onClick={() => setViewingDeal(deal)}
                      className="cursor-pointer border-b border-[var(--color-card-border)] transition-colors hover:bg-surface-container"
                    >
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${deal.title} for admin deal owner assignment`}
                          checked={selectedDealIds.has(deal.id)}
                          onChange={() => toggleDealSelection(deal.id)}
                          className="h-4 w-4 rounded border-[var(--color-pib-line)] bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-on-surface">{deal.title}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-label uppercase tracking-wide" style={{ background: `${color}20`, color }}>
                          {stage?.label ?? deal.stageId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant">{dealOwnerLabel(deal)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-on-surface-variant">{fmtDealValue(deal.value, deal.currency)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-on-surface-variant">{probability}%</td>
                      <td className="px-4 py-3 font-mono text-xs text-on-surface-variant">{fmtDealValue(weighted, deal.currency)}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{dealCompanyLabel(deal)}</td>
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        {deal.contactId ? (
                          <Link href={`/admin/crm/contacts/${deal.contactId}`} className="text-xs text-[var(--color-accent-v2)] hover:underline">
                            {contactLabel || 'View contact'}
                          </Link>
                        ) : (
                          <span className="text-xs text-on-surface-variant">No contact linked</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {!error && viewMode === 'forecast' && (
        loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : (
          <div className="pib-card-section overflow-hidden">
            <div className="flex flex-wrap gap-6 border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
              <div>
                <span className="text-xs text-on-surface-variant">Open value</span>
                <span className="ml-2 text-sm font-semibold text-on-surface">{formatDealsTotal(openDeals, 'value')}</span>
              </div>
              <div>
                <span className="text-xs text-on-surface-variant">Weighted</span>
                <span className="ml-2 text-sm font-semibold text-[var(--color-accent-v2)]">{formatDealsTotal(openDeals, 'weighted')}</span>
              </div>
              <div>
                <span className="text-xs text-on-surface-variant">Open deals</span>
                <span className="ml-2 text-sm font-semibold text-on-surface">{openDeals.length}</span>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-card-border)]">
                  {['Deal', 'Stage', 'Value', 'Prob %', 'Weighted', 'Close'].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openDeals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-on-surface-variant">No open forecast rows.</td>
                  </tr>
                ) : (
                  openDeals.map((deal) => {
                    const stage = stages.find((item) => item.id === deal.stageId)
                    const probability = deal.probability ?? stage?.probability ?? 50
                    const weighted = (deal.value ?? 0) * (probability / 100)
                    return (
                      <tr key={deal.id} className="border-b border-[var(--color-card-border)] transition-colors hover:bg-surface-container">
                        <td className="px-4 py-3 font-medium text-on-surface">{deal.title}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{stage?.label ?? deal.stageId}</td>
                        <td className="px-4 py-3">{fmtDealValue(deal.value, deal.currency)}</td>
                        <td className="px-4 py-3 text-right"><ProbabilityInput deal={deal} onUpdate={handleProbabilityUpdate} /></td>
                        <td className="px-4 py-3 text-[var(--color-accent-v2)]">{fmtDealValue(weighted, deal.currency)}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{deal.expectedCloseDate ? formatRelative(deal.expectedCloseDate) : 'No close date'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {!error && viewMode === 'contacts' && (
        contactsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : filteredContacts.length === 0 ? (
          <EmptyState icon="groups" title="No contacts found." description="Try another search or create contacts from the contacts workspace." />
        ) : (
          <div className="pib-card-section overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-card-border)] bg-white/[0.02]">
                  {['Contact', 'Company', 'Stage', 'Type', 'Last touch', 'Scores'].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((contact) => (
                  <tr key={contact.id} className="border-b border-[var(--color-card-border)] transition-colors hover:bg-surface-container">
                    <td className="px-4 py-3">
                      <Link href={`/admin/crm/contacts/${contact.id}`} className="font-medium text-[var(--color-accent-v2)] hover:underline">
                        {contact.name || contact.email || 'Unnamed contact'}
                      </Link>
                      <p className="mt-0.5 text-xs text-on-surface-variant">{contactEmailLabel(contact)}</p>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{contactCompanyLabel(contact)}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{contact.stage}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{contact.type}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{formatRelative(contact.lastContactedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {typeof contact.leadScore === 'number' && <span className="pill !px-2 !py-0.5 !text-[10px]">Lead {contact.leadScore}</span>}
                        {typeof contact.icpScore === 'number' && <span className="pill !px-2 !py-0.5 !text-[10px]">ICP {contact.icpScore}</span>}
                        {typeof contact.aiLeadScore === 'number' && <span className="pill !px-2 !py-0.5 !text-[10px]">AI {contact.aiLeadScore}</span>}
                        {typeof contact.leadScore !== 'number' && typeof contact.icpScore !== 'number' && typeof contact.aiLeadScore !== 'number' && (
                          <span className="text-xs text-on-surface-variant">Scores not captured</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showCreateDrawer && (
        <DealDrawer
          defaultPipelineId={selectedPipelineId}
          onSaved={handleDealSaved}
          onClose={() => setShowCreateDrawer(false)}
          orgId=""
        />
      )}

      {editingDeal && (
        <DealDrawer
          deal={editingDeal}
          onSaved={handleDealSaved}
          onClose={() => setEditingDeal(null)}
          orgId=""
        />
      )}

      {viewingDeal && !editingDeal && (
        <DealDetailDrawer
          deal={viewingDeal}
          stages={stages}
          orgId=""
          onClose={() => setViewingDeal(null)}
          onEdit={() => { setEditingDeal(viewingDeal); setViewingDeal(null) }}
        />
      )}
    </div>
  )
}
