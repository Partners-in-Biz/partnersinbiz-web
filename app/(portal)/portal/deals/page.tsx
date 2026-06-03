'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  DealPipelineCommandBar,
  matchesDealFocus,
  type DealFocusMode,
} from '@/components/crm/DealPipelineCommandBar'
import { DealKanban } from '@/components/crm/DealKanban'
import { PipelineSelector } from '@/components/crm/PipelineSelector'
import { DealDrawer } from '@/components/crm/DealDrawer'
import { DealDetailDrawer } from '@/components/crm/DealDetailDrawer'
import { EmptyState, PageHeader, PageTabs } from '@/components/ui/AppFoundation'
import type { Contact, Deal, Currency } from '@/lib/crm/types'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

type ViewMode = 'board' | 'list' | 'forecast'

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

// ── Pipeline value summary strip ───────────────────────────────────────────────

interface PipelineSummaryProps {
  deals: Deal[]
  stages: PipelineStage[]
}

function PipelineSummary({ deals, stages }: PipelineSummaryProps) {
  const wonStageIds = new Set(stages.filter(s => s.kind === 'won').map(s => s.id))
  const lostStageIds = new Set(stages.filter(s => s.kind === 'lost').map(s => s.id))

  const primaryCurrency: Currency = (deals.find(d => d.currency)?.currency) ?? 'ZAR'

  function fmt(v: number) {
    try {
      return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: primaryCurrency, maximumFractionDigits: 0 }).format(v)
    } catch {
      return v.toFixed(0)
    }
  }

  const valueStats = deals
    .filter(d => !lostStageIds.has(d.stageId))
    .reduce(
      (stats, d) => {
        const hasValue = typeof d.value === 'number' && Number.isFinite(d.value)
        const stage = stages.find(s => s.id === d.stageId)
        const prob = d.probability ?? stage?.probability ?? 100

        if (hasValue) {
          stats.priced += 1
          stats.total += d.value
          stats.weightedTotal += d.value * (prob / 100)
          if (wonStageIds.has(d.stageId)) stats.won += d.value
        } else {
          stats.unpriced += 1
        }

        return stats
      },
      { priced: 0, unpriced: 0, total: 0, weightedTotal: 0, won: 0 },
    )
  const open = deals.filter(d => !wonStageIds.has(d.stageId) && !lostStageIds.has(d.stageId)).length
  const unpricedCopy = `${valueStats.unpriced} open ${valueStats.unpriced === 1 ? 'deal needs' : 'deals need'} value`
  const hasPipelineRecords = valueStats.priced > 0 || valueStats.unpriced > 0

  return (
    <div className="flex gap-4 flex-wrap">
      {[
        {
          label: 'Pipeline value',
          value: valueStats.priced > 0 ? fmt(valueStats.total) : hasPipelineRecords ? 'No priced pipeline' : 'No open pipeline',
          sub: valueStats.unpriced > 0 ? unpricedCopy : 'excl. lost',
        },
        {
          label: 'Weighted pipeline',
          value: valueStats.priced > 0 ? fmt(valueStats.weightedTotal) : hasPipelineRecords ? 'Forecast value needed' : 'No forecastable deals',
          sub: valueStats.unpriced > 0 ? unpricedCopy : 'prob-adjusted',
        },
        { label: 'Won',            value: fmt(valueStats.won),   sub: 'all time' },
        { label: 'Open deals',     value: String(open), sub: 'active' },
        { label: 'Total deals',    value: String(deals.length), sub: 'all stages' },
      ].map(stat => (
        <div
          key={stat.label}
          className="pib-card px-4 py-3 min-w-[130px]"
        >
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-0.5">{stat.label}</p>
          <p className="text-xl font-headline font-bold text-on-surface leading-none">{stat.value}</p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">{stat.sub}</p>
        </div>
      ))}
    </div>
  )
}

function PipelineLaunchCommandCenter({
  onCreateDeal,
  needsSetupReview = false,
}: {
  onCreateDeal: () => void
  needsSetupReview?: boolean
}) {
  const launchSteps = [
    {
      icon: 'add_circle',
      label: 'First opportunity',
      body: 'Add the first deal with owner, value, stage, and close-date context.',
    },
    {
      icon: 'query_stats',
      label: 'Forecast baseline',
      body: 'Give leadership a weighted pipeline, not a blank board with hidden setup work.',
    },
    {
      icon: 'groups',
      label: 'Team handoff',
      body: 'Attach the buyer and owner so every employee can see who drives the next move.',
    },
  ]

  return (
    <section className="bento-card overflow-hidden !p-0">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="p-6 sm:p-7">
          <p className="eyebrow !text-[10px]">Revenue workspace</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Launch this pipeline</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
            {needsSetupReview
              ? 'This pipeline needs setup review before the team treats it as board-ready. Review the revenue path, then create the first deal with a buyer, owner, value, stage, and forecast date.'
              : 'This board is ready, but there are no opportunities in it yet. Create the first deal so the pipeline has a buyer, owner, value, stage, and forecast date from the start.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCreateDeal}
              className="btn-pib-accent inline-flex items-center gap-2"
              aria-label="Create first deal for this pipeline"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
              Create first deal
            </button>
            <button
              type="button"
              onClick={onCreateDeal}
              className="btn-pib-secondary inline-flex items-center gap-2"
              aria-label="Open deal setup for forecast baseline"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">trending_up</span>
              Build forecast baseline
            </button>
          </div>
        </div>
        <div className="border-t border-[var(--color-pib-line)] bg-white/[0.02] p-4 lg:border-l lg:border-t-0">
          <div className="grid gap-3">
            {launchSteps.map((step) => (
              <div key={step.label} className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/35 p-4">
                <div className="flex gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">
                    {step.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-pib-text)]">{step.label}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{step.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function isPipelineSetupArtifact(pipeline?: Pipeline): boolean {
  const name = pipeline?.name?.trim().toLowerCase() ?? ''
  if (!name) return false
  return /\b(smoke|test|delete)\b/.test(name)
}

function PipelineSetupReviewCard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <section
      role="region"
      aria-label={`Pipeline setup review for ${pipeline.name}`}
      className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">rule_settings</span>
          <div>
            <p className="eyebrow !text-[10px] text-amber-200">Pipeline hygiene</p>
            <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Pipeline setup needs review</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              <span className="font-medium text-[var(--color-pib-text)]">{pipeline.name}</span> looks like smoke-test pipeline data.
              Review pipeline settings before the team treats this as a board-ready revenue path.
            </p>
          </div>
        </div>
        <Link
          href="/portal/settings/pipelines"
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
          aria-label={`Review pipeline settings for ${pipeline.name}`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">settings</span>
          Review settings
        </Link>
      </div>
    </section>
  )
}

// ── Forecast helpers ───────────────────────────────────────────────────────────

function fmtDealValue(value: number | null | undefined, currency?: string, missingLabel = 'No value captured') {
  if (value == null || Number.isNaN(value)) return missingLabel
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency: currency ?? 'ZAR', maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency ?? 'ZAR'} ${value.toFixed(0)}`
  }
}

function formatDealsTotal(deals: Deal[], mode: 'value' | 'weighted') {
  const total = deals.reduce((s, d) => {
    if (mode === 'weighted') return s + (d.value ?? 0) * ((d.probability ?? 50) / 100)
    return s + (d.value ?? 0)
  }, 0)
  return fmtDealValue(total, deals.find(d => d.currency)?.currency)
}

function dealOwnerUid(deal: Deal): string {
  return String(deal.ownerUid ?? deal.ownerRef?.uid ?? '').trim()
}

function hasDealOwner(deal: Deal): boolean {
  return Boolean(dealOwnerUid(deal))
}

function matchesDealOwnerLens(deal: Deal, ownerLens: string): boolean {
  if (ownerLens === 'all') return true
  if (ownerLens === 'unassigned') return !hasDealOwner(deal)
  return dealOwnerUid(deal) === ownerLens
}

function dealOwnerLabel(deal: Deal): string {
  if (deal.ownerRef?.displayName?.trim()) return deal.ownerRef.displayName
  if (deal.ownerUid?.trim()) return 'Deal owner identity missing'
  return 'Unassigned'
}

function dealTitleLabel(deal: Deal): string {
  return deal.title?.trim() || 'Deal name missing'
}

function fallbackStageLabel(stageId?: string): string {
  const normalized = stageId?.trim()
  if (!normalized) return 'Stage not set'

  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function dealStageLabel(deal: Deal, stage?: PipelineStage): string {
  return stage?.label?.trim() || fallbackStageLabel(deal.stageId)
}

function teamMemberLabel(member: TeamMember): string {
  const label = teamMemberDisplayName(member)
  return member.jobTitle?.trim() ? `${label} - ${member.jobTitle.trim()}` : label
}

function teamMemberDisplayName(member: TeamMember): string {
  return member.displayName?.trim()
    || [member.firstName, member.lastName].map((part) => part?.trim()).filter(Boolean).join(' ')
    || member.email?.trim()
    || 'Team member identity missing'
}

function teamMemberOwnerRef(member: TeamMember) {
  return {
    uid: member.uid,
    displayName: teamMemberDisplayName(member),
    ...(member.jobTitle ? { jobTitle: member.jobTitle } : {}),
    kind: 'human' as const,
  }
}

function fmtRelativeDate(ts: unknown): string {
  const date = ts && typeof ts === 'object' && 'toDate' in ts
    ? (ts as { toDate: () => Date }).toDate()
    : new Date(ts as string)
  if (isNaN(date.getTime())) return 'Close date needs review'
  const diffDays = Math.round((date.getTime() - Date.now()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  return `in ${diffDays}d`
}

async function readApiJson(res: Response, fallback: string) {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `${fallback} (${res.status})`
    throw new Error(message)
  }
  return body
}

function ProbabilityInput({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, prob: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(deal.probability ?? 50))

  if (!editing) return (
    <button
      onClick={() => setEditing(true)}
      className="hover:underline text-right w-full cursor-pointer"
    >
      {deal.probability ?? 50}%
    </button>
  )

  return (
    <input
      type="number"
      min={0}
      max={100}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => {
        const n = Math.max(0, Math.min(100, Number(val)))
        onUpdate(deal.id, n)
        setEditing(false)
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-14 text-right border border-[var(--color-pib-accent)] rounded px-1 bg-transparent"
      autoFocus
    />
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const searchParams = useSearchParams()
  const requestedPipelineId = searchParams.get('pipelineId') ?? undefined
  const requestedStageId = searchParams.get('stage') ?? undefined
  const shouldOpenCreateDrawer = searchParams.get('create') === 'deal'
  const [deals, setDeals] = useState<Deal[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [pipelinesLoading, setPipelinesLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string>(() => requestedStageId ?? 'all')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const view = searchParams.get('view')
    return view === 'list' || view === 'forecast' ? view : 'board'
  })
  const [search, setSearch] = useState('')
  const [focusMode, setFocusMode] = useState<DealFocusMode>(() => {
    const focus = searchParams.get('focus')
    return focus === 'atRisk' || focus === 'needsContact' || focus === 'quoteReady' || focus === 'no-close-date'
      ? focus === 'no-close-date' ? 'noCloseDate' : focus
      : 'all'
  })
  const [ownerLens, setOwnerLens] = useState<string>(() => searchParams.get('owner')?.trim() || 'all')
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set())
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [bulkOwnerUid, setBulkOwnerUid] = useState('')
  const [bulkOwnerPending, setBulkOwnerPending] = useState(false)
  const [bulkOwnerError, setBulkOwnerError] = useState('')

  // A5: drawer state
  const [showCreateDrawer, setShowCreateDrawer] = useState(() => shouldOpenCreateDrawer)
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [viewingDeal, setViewingDeal] = useState<Deal | null>(null)

  // Fetch pipelines once on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/crm/pipelines')
      .then(r => readApiJson(r, 'Failed to load pipelines'))
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error ?? 'Failed to load pipelines')
        const list = extractPipelinesList(body)
        setPipelines(list)
        // Auto-select default pipeline
        const requestedPipeline = requestedPipelineId ? list.find(p => p.id === requestedPipelineId) : undefined
        const defaultPl = requestedPipeline ?? list.find(p => p.isDefault) ?? list[0]
        if (defaultPl) {
          setSelectedPipelineId(defaultPl.id)
        } else {
          setLoading(false)
        }
        setPipelinesLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load pipelines')
        setPipelinesLoading(false)
      })
    return () => { cancelled = true }
  }, [requestedPipelineId])

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

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/crm/contacts?limit=200')
      .then(r => readApiJson(r, 'Failed to load contacts'))
      .then(body => {
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

  // Fetch deals whenever selected pipeline changes
  useEffect(() => {
    if (!selectedPipelineId) return
    let cancelled = false
    fetch(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`)
      .then(r => readApiJson(r, 'Failed to load deals'))
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error ?? 'Failed to load deals')
        setDeals(body.data ?? [])
        setStageFilter(requestedStageId ?? 'all')
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setDeals([])
        setError(err.message ?? 'Failed to load deals')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [requestedStageId, selectedPipelineId])

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId)
  const selectedPipelineNeedsReview = isPipelineSetupArtifact(selectedPipeline)
  const stages = useMemo<PipelineStage[]>(
    () => selectedPipeline ? [...selectedPipeline.stages].sort((a, b) => a.order - b.order) : [],
    [selectedPipeline],
  )

  const contactLabelsById = useMemo(() => {
    return contacts.reduce<Record<string, string>>((acc, contact) => {
      const label = contact.name?.trim() || contact.email?.trim()
      if (label) acc[contact.id] = label
      return acc
    }, {})
  }, [contacts])

  const handleStageChange = useCallback(async (dealId: string, newStageId: string) => {
    // Optimistic update happens inside DealKanban; we just fire the PATCH
    const res = await fetch(`/api/v1/crm/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to update deal stage')
    }
    // Sync local list so list-view stays consistent
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stageId: newStageId } : d))
  }, [])

  const handlePipelineChange = useCallback((id: string) => {
    setLoading(true)
    setSelectedPipelineId(id)
    setDeals([])
    setError(null)
  }, [])

  // A5: deal saved callback — refresh the deal list
  const handleDealSaved = useCallback(() => {
    setShowCreateDrawer(false)
    setEditingDeal(null)
    setViewingDeal(null)
    if (selectedPipelineId) {
      setLoading(true)
      fetch(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`)
        .then(r => readApiJson(r, 'Failed to load deals'))
        .then(body => { if (body.success) setDeals(body.data ?? []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [selectedPipelineId])

  function retryDealsLoad() {
    if (!selectedPipelineId) return
    setLoading(true)
    setError(null)
    fetch(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`)
      .then(r => readApiJson(r, 'Failed to load deals'))
      .then(body => {
        if (!body.success) throw new Error(body.error ?? 'Failed to load deals')
        setDeals(body.data ?? [])
        setStageFilter(requestedStageId ?? 'all')
      })
      .catch(err => {
        setDeals([])
        setError(err.message ?? 'Failed to load deals')
      })
      .finally(() => setLoading(false))
  }

  const handleProbabilityUpdate = useCallback(async (dealId: string, probability: number) => {
    // Optimistic update
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, probability } : d))
    // Persist best-effort
    await fetch(`/api/v1/crm/deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probability }),
    }).catch(() => {})
  }, [])

  const filteredDeals = useMemo(() => {
    const query = search.trim().toLowerCase()
    return deals.filter((deal) => {
      const contactLabel = contactLabelsById[deal.contactId]
      const dealTitle = dealTitleLabel(deal)
      const matchesSearch = !query ||
        dealTitle.toLowerCase().includes(query) ||
        deal.companyName?.toLowerCase().includes(query) ||
        deal.contactId?.toLowerCase().includes(query) ||
        contactLabel?.toLowerCase().includes(query) ||
        deal.id.toLowerCase().includes(query)
      const matchesStage = stageFilter === 'all' || deal.stageId === stageFilter
      const matchesOwnerLens = matchesDealOwnerLens(deal, ownerLens)
      return matchesSearch && matchesStage && matchesOwnerLens && matchesDealFocus(deal, stages, focusMode)
    })
  }, [contactLabelsById, deals, focusMode, ownerLens, search, stageFilter, stages])

  const unassignedDeals = useMemo(
    () => deals.filter((deal) => !hasDealOwner(deal)),
    [deals],
  )
  const ownerCoverage = deals.length > 0 ? (deals.length - unassignedDeals.length) / deals.length : 1
  const selectedStage = stageFilter === 'all' ? undefined : stages.find((stage) => stage.id === stageFilter)
  const isStageLens = stageFilter !== 'all'
  const emptyListTitle = ownerLens === 'unassigned'
    ? 'No unassigned deals.'
    : isStageLens
      ? `No deals in ${selectedStage?.label ?? 'this stage'}.`
    : 'No deals found.'
  const emptyListDescription = ownerLens === 'unassigned'
    ? 'Every open deal in this lens has an owner.'
    : isStageLens
      ? 'This pipeline stage is clear for the current deal lens.'
    : ownerLens !== 'all'
      ? 'No deals match this owner lens. Show all deals to return to the full pipeline.'
      : 'Try another stage filter or create a new client-safe deal.'

  useEffect(() => {
    setSelectedDealIds((current) => {
      if (current.size === 0) return current
      const visibleIds = new Set(filteredDeals.map((deal) => deal.id))
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [filteredDeals])

  function toggleDealSelection(id: string) {
    setSelectedDealIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleVisibleDeals() {
    const visibleIds = filteredDeals.map((deal) => deal.id)
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

  function selectUnassignedDealsForAssignment() {
    const ids = unassignedDeals.map((deal) => deal.id)
    if (!ids.length) return
    setSelectedDealIds(new Set(ids))
    setBulkOwnerUid('')
    setBulkOwnerError('')
    setOwnerLens('unassigned')
    setViewMode('list')
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

  // Open deals for forecast view: exclude lost-stage deals
  const lostStageIds = new Set(stages.filter(s => s.kind === 'lost').map(s => s.id))
  const wonStageIds = new Set(stages.filter(s => s.kind === 'won').map(s => s.id))
  const openDeals = filteredDeals
    .filter(d => !lostStageIds.has(d.stageId) && !wonStageIds.has(d.stageId))
    .slice()
    .sort((a, b) => {
      const aDate = a.expectedCloseDate
      const bDate = b.expectedCloseDate
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      const aMs = typeof aDate === 'object' && 'toDate' in aDate
        ? (aDate as { toDate: () => Date }).toDate().getTime()
        : new Date(aDate as unknown as string).getTime()
      const bMs = typeof bDate === 'object' && 'toDate' in bDate
        ? (bDate as { toDate: () => Date }).toDate().getTime()
        : new Date(bDate as unknown as string).getTime()
      return aMs - bMs
    })
  const forecastEmptyTitle = focusMode === 'noCloseDate'
    ? 'No deals missing close dates.'
    : 'No forecastable deals yet'
  const forecastEmptyDescription = focusMode === 'noCloseDate'
    ? 'Every open opportunity in this forecast lens has an expected close date.'
    : 'Create an open opportunity with value, probability, owner, and close date so leadership can trust the forecast.'

  const isReady = !pipelinesLoading && !loading && !contactsLoading

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Client workspace / Deals"
        title="Pipeline"
        description="Track shared opportunities and forecasts with the same workspace controls as admin, limited to client-safe CRM actions."
        actions={(
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {pipelines.length > 0 && (
              <PipelineSelector
                pipelines={pipelines}
                selectedId={selectedPipelineId}
                onChange={handlePipelineChange}
                className="w-48"
              />
            )}

            <button
              onClick={() => setShowCreateDrawer(true)}
              className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm"
              aria-label="New deal"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
              New deal
            </button>
          </div>
        )}
      />

      <PageTabs
        tabs={[
          { value: 'board', label: 'Board', icon: 'view_kanban' },
          { value: 'list', label: 'List', icon: 'list' },
          { value: 'forecast', label: 'Forecast', icon: 'trending_up' },
        ]}
        value={viewMode}
        onValueChange={(id) => setViewMode(id as 'board' | 'list' | 'forecast')}
        variant="segmented"
        ariaLabel="Deal view mode"
      />

      {/* Summary strip */}
      {isReady && !error && <PipelineSummary deals={deals} stages={stages} />}

      {isReady && !error && selectedPipeline && selectedPipelineNeedsReview && (
        <PipelineSetupReviewCard pipeline={selectedPipeline} />
      )}

      {isReady && !error && (
        <section className="grid gap-3 md:grid-cols-[220px_1fr_1fr]">
          <div className="pib-card px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Deal owner coverage</p>
              <span className="material-symbols-outlined text-[17px] text-on-surface-variant">supervisor_account</span>
            </div>
            <p className="mt-2 text-2xl font-headline font-bold text-on-surface leading-none">{Math.round(ownerCoverage * 100)}%</p>
            <p className="mt-1 text-[11px] text-on-surface-variant">{unassignedDeals.length} unassigned</p>
          </div>
          <button
            type="button"
            onClick={() => setOwnerLens(ownerLens === 'all' ? 'unassigned' : 'all')}
            className={[
              'rounded-[var(--radius-card)] border p-4 text-left transition-colors',
              ownerLens !== 'all'
                ? 'border-amber-400/40 bg-amber-400/10'
                : 'border-[var(--color-pib-line)] bg-white/[0.03] hover:bg-white/[0.05]',
            ].join(' ')}
            aria-label={ownerLens !== 'all' ? 'Show all deals' : 'Show unassigned deals needing an owner'}
          >
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">manage_accounts</span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">
              {ownerLens === 'unassigned' ? 'Showing unassigned deals' : ownerLens !== 'all' ? 'Showing selected owner deals' : 'Review unassigned deals'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              {ownerLens !== 'all' && ownerLens !== 'unassigned'
                ? 'This report lens is showing deals owned by the selected rep. Show all deals to return to the full pipeline.'
                : unassignedDeals.length > 0
                ? `${unassignedDeals.length} deals need an owner before forecast and follow-up accountability can be trusted.`
                : 'Every visible deal has an owner.'}
            </p>
          </button>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">query_stats</span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">Pipeline responsibility</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              Use owner coverage with the forecast and stage lenses so open revenue always has a named person behind it.
            </p>
            <button
              type="button"
              onClick={selectUnassignedDealsForAssignment}
              disabled={unassignedDeals.length === 0}
              className="btn-pib-secondary mt-4 w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                unassignedDeals.length === 0
                  ? 'No unassigned deals to select for owner assignment'
                  : unassignedDeals.length === 1
                  ? 'Select 1 unassigned deal for owner assignment'
                  : `Select ${unassignedDeals.length} unassigned deals for owner assignment`
              }
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">playlist_add_check</span>
              {unassignedDeals.length > 0
                ? `Select ${unassignedDeals.length} owner gap${unassignedDeals.length === 1 ? '' : 's'}`
                : 'No owner gaps'}
            </button>
          </div>
        </section>
      )}

      {isReady && !error && (
        <DealPipelineCommandBar
          deals={deals}
          stages={stages}
          search={search}
          focusMode={focusMode}
          onSearchChange={setSearch}
          onFocusModeChange={setFocusMode}
        />
      )}

      {isReady && !error && selectedDealIds.size > 0 && (
        <section className="pib-card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="dealBulkOwner" className="pib-label">Assign selected deals to owner</label>
            <select
              id="dealBulkOwner"
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
            aria-label={`Assign owner to ${selectedDealIds.size} selected deal${selectedDealIds.size === 1 ? '' : 's'}`}
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

      {/* Stage filter pills */}
      {stages.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(['all', ...stages.map(s => s.id)] as const).map(s => {
            const stage = stages.find(st => st.id === s)
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                aria-pressed={stageFilter === s}
                className={[
                  'text-xs font-label px-3 py-1.5 rounded-[var(--radius-btn)] transition-colors capitalize',
                  stageFilter === s
                    ? 'text-black font-medium'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
                ].join(' ')}
                style={stageFilter === s ? { background: 'var(--color-accent-v2)' } : {}}
              >
                {s === 'all' ? 'All stages' : (stage?.label ?? s)}
              </button>
            )
          })}
        </div>
      )}

      {/* Error state */}
      {error && (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  {selectedPipelineId ? 'Deals could not load' : 'Pipeline could not load'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{error}</p>
              </div>
            </div>
            {selectedPipelineId && (
              <button
                type="button"
                onClick={retryDealsLoad}
                className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
                aria-label="Retry loading deals"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
                Retry
              </button>
            )}
          </div>
        </section>
      )}

      {/* Board view */}
      {!error && viewMode === 'board' && stages.length > 0 && (
        loading ? (
          <DealKanban
            deals={[]}
            stages={stages}
            loading
            onStageChange={handleStageChange}
            contactLabelsById={contactLabelsById}
          />
        ) : filteredDeals.length === 0 && stageFilter === 'all' ? (
          <PipelineLaunchCommandCenter
            onCreateDeal={() => setShowCreateDrawer(true)}
            needsSetupReview={selectedPipelineNeedsReview}
          />
        ) : (
          <DealKanban
            deals={filteredDeals}
            stages={stages}
            onStageChange={handleStageChange}
            contactLabelsById={contactLabelsById}
          />
        )
      )}

      {/* Board loading state when pipeline not yet loaded */}
      {!error && viewMode === 'board' && stages.length === 0 && pipelinesLoading && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col w-64 shrink-0 gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {!error && viewMode === 'list' && (
        loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : filteredDeals.length === 0 ? (
          <EmptyState
            icon="search_off"
            title={emptyListTitle}
            description={emptyListDescription}
            action={ownerLens !== 'all' ? (
              <button
                type="button"
                onClick={() => setOwnerLens('all')}
                className="btn-pib-secondary inline-flex items-center gap-1.5"
                aria-label="Show all deals"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">filter_alt_off</span>
                Show all deals
              </button>
            ) : isStageLens ? (
              <button
                type="button"
                onClick={() => setStageFilter('all')}
                className="btn-pib-secondary inline-flex items-center gap-1.5"
                aria-label="Show all stages"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">filter_alt_off</span>
                Show all stages
              </button>
            ) : undefined}
          />
        ) : (
          <div className="pib-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-card-border)' }}>
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select visible deals for owner assignment"
                      checked={filteredDeals.length > 0 && filteredDeals.every((deal) => selectedDealIds.has(deal.id))}
                      onChange={toggleVisibleDeals}
                      className="h-4 w-4 rounded border-[var(--color-pib-line)] bg-transparent"
                    />
                  </th>
                  {['Deal', 'Stage', 'Owner', 'Value', 'Prob', 'Weighted', 'Contact'].map(h => (
                    <th
                      key={h}
                      className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant px-4 py-2.5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map(deal => {
                  const stage = stages.find(s => s.id === deal.stageId)
                  const stageColor = stage?.color ?? stageColorByKind(stage?.kind)
                  const stageLabel = dealStageLabel(deal, stage)
                  const prob = deal.probability ?? stage?.probability ?? 100
                  const weighted = (deal.value ?? 0) * (prob / 100)
                  const contactLabel = contactLabelsById[deal.contactId]
                  const dealTitle = dealTitleLabel(deal)
                  const hasCapturedValue = typeof deal.value === 'number' && Number.isFinite(deal.value)
                  const hasAssignedOwner = hasDealOwner(deal)
                  return (
                    <tr
                      key={deal.id}
                      data-deal-row
                      className="border-b transition-colors hover:bg-[var(--color-surface-container)] cursor-pointer"
                      style={{ borderColor: 'var(--color-card-border)' }}
                      onClick={() => setViewingDeal(deal)}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${dealTitle} for deal owner assignment`}
                          checked={selectedDealIds.has(deal.id)}
                          onChange={() => toggleDealSelection(deal.id)}
                          className="h-4 w-4 rounded border-[var(--color-pib-line)] bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-on-surface">
                        <Link
                          href={`/portal/deals/${deal.id}`}
                          className="hover:text-[var(--color-pib-accent)] transition-colors font-medium"
                          onClick={e => e.stopPropagation()}
                        >
                          {dealTitle}
                        </Link>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Edit stage for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex rounded-md border border-transparent p-0.5 transition-colors hover:border-[var(--color-pib-accent)]"
                        >
                          <span
                            className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
                            style={{
                              background: `${stageColor}20`,
                              color: stageColor,
                            }}
                          >
                            {stageLabel}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`${hasAssignedOwner ? 'Edit owner' : 'Assign owner'} for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                            {hasAssignedOwner ? 'manage_accounts' : 'person_add'}
                          </span>
                          <span className="truncate">{dealOwnerLabel(deal)}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-on-surface-variant text-xs" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`${hasCapturedValue ? 'Edit' : 'Add'} value for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                            {hasCapturedValue ? 'edit' : 'add'}
                          </span>
                          {fmtDealValue(deal.value, deal.currency)}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Edit probability for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex rounded-md border border-transparent p-0.5 transition-colors hover:border-[var(--color-pib-accent)]"
                        >
                          <span
                            className="px-1.5 py-0.5 rounded-full text-[10px]"
                            style={{
                              background: prob >= 70 ? '#4ade8020' : prob >= 40 ? '#facc1520' : '#f8717120',
                              color: prob >= 70 ? '#4ade80' : prob >= 40 ? '#facc15' : '#f87171',
                            }}
                          >
                            {prob}%
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-on-surface-variant text-xs">
                        {fmtDealValue(weighted, deal.currency)}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {deal.contactId ? (
                          <a
                            href={`/portal/contacts/${deal.contactId}`}
                            className="text-xs text-[var(--color-accent-v2)] hover:underline"
                          >
                            {contactLabel || 'Contact identity missing'}
                          </a>
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
      {/* Forecast view */}
      {!error && viewMode === 'forecast' && (
        loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : (
          <div className="bento-card !p-0 overflow-hidden">
            {/* Summary bar */}
            <div className="flex gap-6 px-5 py-3 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
              <div>
                <span className="text-xs text-[var(--color-pib-text-muted)]">Total value</span>
                <span className="ml-2 text-sm font-semibold">{formatDealsTotal(openDeals, 'value')}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--color-pib-text-muted)]">Weighted</span>
                <span className="ml-2 text-sm font-semibold text-[var(--color-pib-accent)]">{formatDealsTotal(openDeals, 'weighted')}</span>
              </div>
            </div>

            {/* Table */}
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--color-pib-text-muted)] border-b border-[var(--color-pib-line)]">
                <tr>
                  <th className="text-left px-4 py-2">Deal</th>
                  <th className="text-left px-4 py-2 hidden md:table-cell">Stage</th>
                  <th className="text-right px-4 py-2">Value</th>
                  <th className="text-right px-4 py-2">Prob %</th>
                  <th className="text-right px-4 py-2">Weighted</th>
                  <th className="text-right px-4 py-2 hidden lg:table-cell">Close Date</th>
                </tr>
              </thead>
              <tbody>
                {openDeals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      <div className="mx-auto flex max-w-xl flex-col items-center rounded-xl border border-dashed border-[var(--color-pib-line)] bg-white/[0.03] px-5 py-6">
                        <span className="material-symbols-outlined flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] text-[24px] text-[var(--color-pib-text-muted)]">
                          trending_up
                        </span>
                        <p className="eyebrow mt-4 !text-[10px]">Forecast setup</p>
                        <h3 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">{forecastEmptyTitle}</h3>
                        <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-pib-text-muted)]">
                          {forecastEmptyDescription}
                        </p>
                        {focusMode === 'noCloseDate' ? (
                          <button
                            type="button"
                            onClick={() => setFocusMode('all')}
                            className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5 text-xs"
                            aria-label="Show full forecast"
                          >
                            <span className="material-symbols-outlined text-[15px]">filter_alt_off</span>
                            Show full forecast
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowCreateDrawer(true)}
                            className="btn-pib-accent mt-5 inline-flex items-center gap-1.5 text-xs"
                          >
                            <span className="material-symbols-outlined text-[15px]">add</span>
                            Create forecastable deal
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  openDeals.map(deal => {
                    const stage = stages.find(s => s.id === deal.stageId)
                    const stageLabel = dealStageLabel(deal, stage)
                    const prob = deal.probability ?? stage?.probability ?? 50
                    const weighted = (deal.value ?? 0) * (prob / 100)
                    const dealTitle = dealTitleLabel(deal)
                    return (
                      <tr
                        key={deal.id}
                        className="border-b border-[var(--color-pib-line)] last:border-0 hover:bg-[var(--color-pib-surface)] transition-colors"
                      >
                        <td className="px-4 py-3 font-medium">
                          <Link
                            href={`/portal/deals/${deal.id}`}
                            className="hover:text-[var(--color-pib-accent)] transition-colors"
                          >
                            {dealTitle}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)] hidden md:table-cell">{stageLabel}</td>
                        <td className="px-4 py-3 text-right">{fmtDealValue(deal.value, deal.currency)}</td>
                        <td className="px-4 py-3 text-right">
                          <ProbabilityInput deal={deal} onUpdate={handleProbabilityUpdate} />
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-pib-accent)]">
                          {fmtDealValue(weighted, deal.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-pib-text-muted)] hidden lg:table-cell">
                          <button
                            type="button"
                            onClick={() => setEditingDeal(deal)}
                            aria-label={`${deal.expectedCloseDate ? 'Edit' : 'Add'} close date for ${dealTitle} from forecast`}
                            className="inline-flex rounded-md border border-transparent px-1.5 py-1 text-right transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                          >
                            {deal.expectedCloseDate ? fmtRelativeDate(deal.expectedCloseDate) : 'No close date captured'}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* A5: Create deal drawer */}
      {showCreateDrawer && (
        <DealDrawer
          defaultPipelineId={selectedPipelineId}
          onSaved={handleDealSaved}
          onClose={() => setShowCreateDrawer(false)}
          orgId={''}
        />
      )}

      {/* A5: Edit deal drawer */}
      {editingDeal && (
        <DealDrawer
          deal={editingDeal}
          defaultContactLabel={contactLabelsById[editingDeal.contactId]}
          onSaved={handleDealSaved}
          onClose={() => setEditingDeal(null)}
          orgId={''}
        />
      )}

      {/* A5: Deal detail drawer */}
      {viewingDeal && !editingDeal && (
        <DealDetailDrawer
          deal={viewingDeal}
          stages={stages}
          orgId={''}
          contactLabel={contactLabelsById[viewingDeal.contactId]}
          onClose={() => setViewingDeal(null)}
          onEdit={() => { setEditingDeal(viewingDeal); setViewingDeal(null) }}
        />
      )}
    </div>
  )
}

// Helper: fallback color by stage kind when no custom color is set
function stageColorByKind(kind?: string): string {
  if (kind === 'won')  return '#4ade80'
  if (kind === 'lost') return '#ef4444'
  return '#60a5fa' // open stages default to blue
}
