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
import { EmptyState, PageHeader, PageTabs, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import type { Contact, Deal, Currency } from '@/lib/crm/types'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { Icon } from '@/components/studio'

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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {[
        {
          label: 'Pipeline value',
          value: valueStats.priced > 0 ? fmt(valueStats.total) : hasPipelineRecords ? 'No priced pipeline' : 'No open pipeline',
          sub: valueStats.unpriced > 0 ? unpricedCopy : 'excl. lost',
          icon: 'payments',
        },
        {
          label: 'Weighted pipeline',
          value: valueStats.priced > 0 ? fmt(valueStats.weightedTotal) : hasPipelineRecords ? 'Forecast value needed' : 'No forecastable deals',
          sub: valueStats.unpriced > 0 ? unpricedCopy : 'prob-adjusted',
          icon: 'trending_up',
        },
        { label: 'Won',            value: fmt(valueStats.won),   sub: 'all time', icon: 'emoji_events' },
        { label: 'Open deals',     value: String(open), sub: 'active', icon: 'view_kanban' },
        { label: 'Total deals',    value: String(deals.length), sub: 'all stages', icon: 'handshake' },
      ].map(stat => (
        <StatCard
          key={stat.label}
          accent="amber"
          icon={stat.icon}
          label={stat.label}
          value={stat.value}
          detail={stat.sub}
          className="min-w-0"
        />
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
    <Surface variant="card" accentEdge="amber">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="pib-label mb-0">Revenue workspace</p>
          <h2 className="mt-1 text-sm text-[var(--color-pib-text)]">Launch this pipeline</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
            {needsSetupReview
              ? 'This pipeline needs setup review before the team treats it as board-ready. Review the revenue path, then create the first deal with a buyer, owner, value, stage, and forecast date.'
              : 'This board is ready, but there are no opportunities in it yet. Create the first deal so the pipeline has a buyer, owner, value, stage, and forecast date from the start.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onCreateDeal}
              className="btn-pib-primary btn-pib-sm"
              aria-label="Create first deal for this pipeline"
            >
              <Icon name="add" />
              Create first deal
            </button>
            <button
              type="button"
              onClick={onCreateDeal}
              className="btn-pib-secondary btn-pib-sm"
              aria-label="Open deal setup for forecast baseline"
            >
              <Icon name="trending_up" />
              Build forecast baseline
            </button>
          </div>
        </div>
        <div className="grid gap-2">
          {launchSteps.map((step) => (
            <div key={step.label} className="rounded-lg border border-[var(--color-pib-line)] p-2.5">
              <div className="flex gap-2.5">
                <Icon name={step.icon} />
                <div>
                  <p className="text-xs text-[var(--color-pib-text)]">{step.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{step.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Surface>
  )
}

function isPipelineSetupArtifact(pipeline?: Pipeline): boolean {
  const name = pipeline?.name?.trim().toLowerCase() ?? ''
  if (!name) return false
  return /\b(smoke|test|delete)\b/.test(name)
}

function PipelineSetupReviewCard({ pipeline, settingsHref }: { pipeline: Pipeline; settingsHref: string }) {
  return (
    <section
      role="region"
      aria-label={`Pipeline setup review for ${pipeline.name}`}
      className="rounded-[var(--st-radius-raised)] border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] p-3"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-2.5">
          <Icon name="rule_settings" />
          <div>
            <p className="pib-label mb-0 text-[var(--color-pib-accent)]">Pipeline hygiene</p>
            <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">Pipeline setup needs review</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
              <span className="font-medium text-[var(--color-pib-text)]">{pipeline.name}</span> looks like smoke-test pipeline data.
              Review pipeline settings before the team treats this as a board-ready revenue path.
            </p>
          </div>
        </div>
        <Link
          href={settingsHref}
          className="btn-pib-secondary btn-pib-sm shrink-0"
          aria-label={`Review pipeline settings for ${pipeline.name}`}
        >
          <Icon name="settings" />
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
      className="w-14 text-right border border-[var(--color-accent-v2)] rounded-md px-1 bg-transparent text-xs"
      aria-label={`Probability for ${dealTitleLabel(deal)}`}
      autoFocus
    />
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const searchParams = useSearchParams()
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const dealApiPath = useCallback((path: string) => scopedApiPath(path, routeScope), [routeScope])
  const dealPortalPath = useCallback((path: string) => scopedPortalPath(path, routeScope), [routeScope])
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
    fetch(dealApiPath('/api/v1/crm/pipelines'))
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
  }, [dealApiPath, requestedPipelineId])

  useEffect(() => {
    let cancelled = false
    fetch(dealApiPath('/api/v1/portal/settings/team'))
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
  }, [dealApiPath])

  useEffect(() => {
    let cancelled = false
    fetch(dealApiPath('/api/v1/crm/contacts?limit=200'))
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
  }, [dealApiPath])

  // Fetch deals whenever selected pipeline changes
  useEffect(() => {
    if (!selectedPipelineId) return
    let cancelled = false
    fetch(dealApiPath(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`))
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
  }, [dealApiPath, requestedStageId, selectedPipelineId])

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
    const res = await fetch(dealApiPath(`/api/v1/crm/deals/${dealId}`), {
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
  }, [dealApiPath])

  const handlePipelineChange = useCallback((id: string) => {
    setLoading(true)
    setSelectedPipelineId(id)
    setDeals([])
    setError(null)
  }, [])

  // A5: deal saved callback - refresh the deal list
  const handleDealSaved = useCallback(() => {
    setShowCreateDrawer(false)
    setEditingDeal(null)
    setViewingDeal(null)
    if (selectedPipelineId) {
      setLoading(true)
      fetch(dealApiPath(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`))
        .then(r => readApiJson(r, 'Failed to load deals'))
        .then(body => { if (body.success) setDeals(body.data ?? []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [dealApiPath, selectedPipelineId])

  function retryDealsLoad() {
    if (!selectedPipelineId) return
    setLoading(true)
    setError(null)
    fetch(dealApiPath(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`))
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
    await fetch(dealApiPath(`/api/v1/crm/deals/${dealId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probability }),
    }).catch(() => {})
  }, [dealApiPath])

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
        const res = await fetch(dealApiPath(`/api/v1/crm/deals/${dealId}`), {
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
    <div className="space-y-4" data-module-accent="amber">
      <PageHeader
        accent="amber"
        eyebrow="CRM · Deals"
        title="Pipeline"
        description="Track shared opportunities and forecasts with the same workspace controls as admin, limited to client-safe CRM actions."
        actions={
          <>
            {pipelines.length > 0 && (
              <PipelineSelector
                pipelines={pipelines}
                selectedId={selectedPipelineId}
                onChange={handlePipelineChange}
                className="w-44"
              />
            )}
            <button
              type="button"
              onClick={() => setShowCreateDrawer(true)}
              className="btn-pib-primary btn-pib-sm"
              aria-label="New deal"
            >
              <Icon name="add" />
              New deal
            </button>
          </>
        }
        tabs={
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
        }
      />

      {/* Summary strip */}
      {isReady && !error && <PipelineSummary deals={deals} stages={stages} />}

      {isReady && !error && selectedPipeline && selectedPipelineNeedsReview && (
        <PipelineSetupReviewCard pipeline={selectedPipeline} settingsHref={dealPortalPath('/portal/settings/pipelines')} />
      )}

      {isReady && !error && (
        <section className="grid gap-2 md:grid-cols-[180px_1fr_1fr]">
          <StatCard
            accent="amber"
            icon="supervisor_account"
            label="Deal owner coverage"
            value={`${Math.round(ownerCoverage * 100)}%`}
            detail={`${unassignedDeals.length} unassigned`}
          />
          <button
            type="button"
            onClick={() => setOwnerLens(ownerLens === 'all' ? 'unassigned' : 'all')}
            className={[
              'rounded-lg border p-3 text-left transition-colors',
              ownerLens !== 'all'
                ? 'border-[var(--color-pib-line-strong)] bg-[var(--color-pib-surface-soft)]'
                : 'border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)]',
            ].join(' ')}
            aria-label={ownerLens !== 'all' ? 'Show all deals' : 'Show unassigned deals needing an owner'}
          >
            <div className="flex items-start gap-2">
              <Icon name="manage_accounts" />
              <span className="min-w-0">
                <p className="text-xs text-[var(--color-pib-text)]">
                  {ownerLens === 'unassigned' ? 'Showing unassigned deals' : ownerLens !== 'all' ? 'Showing selected owner deals' : 'Review unassigned deals'}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                  {ownerLens !== 'all' && ownerLens !== 'unassigned'
                    ? 'This report lens is showing deals owned by the selected rep. Show all deals to return to the full pipeline.'
                    : unassignedDeals.length > 0
                    ? `${unassignedDeals.length} deals need an owner before forecast and follow-up accountability can be trusted.`
                    : 'Every visible deal has an owner.'}
                </p>
              </span>
            </div>
          </button>
          <Surface variant="quiet" className="!p-3">
            <div className="flex items-start gap-2">
              <Icon name="query_stats" />
              <div className="min-w-0">
                <p className="text-xs text-[var(--color-pib-text)]">Pipeline responsibility</p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                  Use owner coverage with the forecast and stage lenses so open revenue always has a named person behind it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={selectUnassignedDealsForAssignment}
              disabled={unassignedDeals.length === 0}
              className="btn-pib-secondary btn-pib-sm mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                unassignedDeals.length === 0
                  ? 'No unassigned deals to select for owner assignment'
                  : unassignedDeals.length === 1
                  ? 'Select 1 unassigned deal for owner assignment'
                  : `Select ${unassignedDeals.length} unassigned deals for owner assignment`
              }
            >
              <Icon name="playlist_add_check" />
              {unassignedDeals.length > 0
                ? `Select ${unassignedDeals.length} owner gap${unassignedDeals.length === 1 ? '' : 's'}`
                : 'No owner gaps'}
            </button>
          </Surface>
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
        <section className="pib-card flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
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
            className="btn-pib-primary btn-pib-sm disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Assign owner to ${selectedDealIds.size} selected deal${selectedDealIds.size === 1 ? '' : 's'}`}
          >
            <Icon name="supervisor_account" />
            {bulkOwnerPending ? 'Assigning...' : 'Assign owner'}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedDealIds(new Set()); setBulkOwnerUid(''); setBulkOwnerError('') }}
            className="btn-pib-ghost btn-pib-sm"
          >
            Clear selection
          </button>
          <p className="basis-full text-[11px] text-[var(--color-pib-text-muted)]">
            {selectedDealIds.size} selected for owner assignment.
          </p>
          {bulkOwnerError && <p className="basis-full text-xs text-red-300">{bulkOwnerError}</p>}
        </section>
      )}

      {/* Stage filter pills */}
      {stages.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...stages.map(s => s.id)] as const).map(s => {
            const stage = stages.find(st => st.id === s)
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                aria-pressed={stageFilter === s}
                className={[
                  'flex h-7 shrink-0 items-center rounded border px-2.5 text-[11px] font-label transition capitalize',
                  stageFilter === s
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]',
                ].join(' ')}
              >
                {s === 'all' ? 'All stages' : (stage?.label ?? s)}
              </button>
            )
          })}
        </div>
      )}

      {/* Error state */}
      {error && (
        <section className="rounded-[var(--st-radius-raised)] border border-[var(--sc-line-strong)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]/[0.07] p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-2.5">
              <Icon name="warning" className="mt-0.5 text-[var(--st-warning)]" />
              <div>
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--st-warning)]">Source health</p>
                <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                  {selectedPipelineId ? 'Deals could not load' : 'Pipeline could not load'}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{error}</p>
              </div>
            </div>
            {selectedPipelineId && (
              <button
                type="button"
                onClick={retryDealsLoad}
                className="btn-pib-secondary btn-pib-sm shrink-0"
                aria-label="Retry loading deals"
              >
                <Icon name="refresh" />
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
            contactHrefForDeal={(deal) => dealPortalPath(`/portal/contacts/${deal.contactId}`)}
            companyHrefForDeal={(deal) => dealPortalPath(`/portal/companies/${deal.companyId}`)}
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
            onEditDeal={deal => setEditingDeal(deal)}
            contactHrefForDeal={(deal) => dealPortalPath(`/portal/contacts/${deal.contactId}`)}
            companyHrefForDeal={(deal) => dealPortalPath(`/portal/companies/${deal.companyId}`)}
          />
        )
      )}

      {/* Board loading state when pipeline not yet loaded */}
      {!error && viewMode === 'board' && stages.length === 0 && pipelinesLoading && (
        <div className="flex gap-3 overflow-x-auto pib-card">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col w-56 shrink-0 gap-1.5">
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
                className="btn-pib-secondary btn-pib-sm"
                aria-label="Show all deals"
              >
                <Icon name="filter_alt_off" />
                Show all deals
              </button>
            ) : isStageLens ? (
              <button
                type="button"
                onClick={() => setStageFilter('all')}
                className="btn-pib-secondary btn-pib-sm"
                aria-label="Show all stages"
              >
                <Icon name="filter_alt_off" />
                Show all stages
              </button>
            ) : undefined}
          />
        ) : (
          <div className="pib-surface pib-surface-table">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)]">
                  <th className="w-10 px-3 py-2">
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
                      className="pib-label text-left px-3 py-2"
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
                      className="border-b border-[var(--color-pib-line)] transition-colors hover:bg-[var(--color-row-hover)] cursor-pointer"
                      onClick={() => setViewingDeal(deal)}
                    >
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${dealTitle} for deal owner assignment`}
                          checked={selectedDealIds.has(deal.id)}
                          onChange={() => toggleDealSelection(deal.id)}
                          className="h-4 w-4 rounded border-[var(--color-pib-line)] bg-transparent"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-[var(--color-pib-text)]">
                        <Link
                          href={dealPortalPath(`/portal/deals/${deal.id}`)}
                          className="hover:text-[var(--color-accent-text)] transition-colors font-medium"
                          onClick={e => e.stopPropagation()}
                        >
                          {dealTitle}
                        </Link>
                      </td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Edit stage for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex rounded-md border border-transparent p-0.5 transition-colors hover:border-[var(--color-accent-v2)]"
                        >
                          <span
                            className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded"
                            style={{
                              background: `${stageColor}20`,
                              color: stageColor,
                            }}
                          >
                            {stageLabel}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-pib-text-muted)]" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`${hasAssignedOwner ? 'Edit owner' : 'Assign owner'} for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-[var(--color-accent-v2)] hover:text-[var(--color-pib-text)]"
                        >
                          <Icon name={hasAssignedOwner ? 'manage_accounts' : 'person_add'} />
                          <span className="truncate">{dealOwnerLabel(deal)}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--color-pib-text-muted)] text-xs" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`${hasCapturedValue ? 'Edit' : 'Add'} value for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-[var(--color-accent-v2)] hover:text-[var(--color-pib-text)]"
                        >
                          <Icon name={hasCapturedValue ? 'edit' : 'add'} />
                          {fmtDealValue(deal.value, deal.currency)}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Edit probability for ${dealTitle} from deals list`}
                          onClick={() => setEditingDeal(deal)}
                          className="inline-flex rounded-md border border-transparent p-0.5 transition-colors hover:border-[var(--color-accent-v2)]"
                        >
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            prob >= 70
                              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
                              : prob >= 40
                                ? 'border-[var(--sc-line-strong)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)]'
                                : 'border-red-400/40 bg-red-400/10 text-red-100'
                          }`}>
                            {prob}%
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--color-pib-text-muted)] text-xs">
                        {fmtDealValue(weighted, deal.currency)}
                      </td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {deal.contactId ? (
                          <a
                            href={dealPortalPath(`/portal/contacts/${deal.contactId}`)}
                            className="text-xs text-[var(--color-accent-v2)] hover:underline"
                          >
                            {contactLabel || 'Contact identity missing'}
                          </a>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Link contact for ${dealTitle} from deals list`}
                            onClick={() => setEditingDeal(deal)}
                            className="inline-flex items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:border-[var(--color-accent-v2)] hover:text-[var(--color-pib-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-v2)]"
                          >
                            <Icon name="person_add" />
                            No contact linked
                          </button>
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
          <div className="pib-surface pib-surface-table">
            {/* Summary bar */}
            <div className="flex gap-4 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] px-3 py-2">
              <div>
                <span className="text-[11px] text-[var(--color-pib-text-muted)]">Total value</span>
                <span className="ml-2 text-xs text-[var(--color-pib-text)]">{formatDealsTotal(openDeals, 'value')}</span>
              </div>
              <div>
                <span className="text-[11px] text-[var(--color-pib-text-muted)]">Weighted</span>
                <span className="ml-2 text-xs text-[var(--color-accent-text)]">{formatDealsTotal(openDeals, 'weighted')}</span>
              </div>
            </div>

            {/* Table */}
            <table className="w-full text-xs">
              <thead className="pib-label border-b border-[var(--color-pib-line)]">
                <tr>
                  <th className="text-left px-3 py-2">Deal</th>
                  <th
                    className="text-left px-3 py-2 hidden md:table-cell"
                    data-impeccable-disable="content-invisible-at-rest"
                  >
                    Stage
                  </th>
                  <th className="text-right px-3 py-2">Value</th>
                  <th className="text-right px-3 py-2">Prob %</th>
                  <th className="text-right px-3 py-2">Weighted</th>
                  <th
                    className="text-right px-3 py-2 hidden lg:table-cell"
                    data-impeccable-disable="content-invisible-at-rest"
                  >
                    Close Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {openDeals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center">
                      <div className="mx-auto flex max-w-xl flex-col items-center rounded-[14px] border border-dashed border-[var(--color-pib-line)] px-4 py-6">
                        <Icon name="trending_up" />
                        <p className="mt-3 eyebrow">Forecast setup</p>
                        <h3 className="mt-1 text-sm text-[var(--color-pib-text)]">{forecastEmptyTitle}</h3>
                        <p className="mt-1 max-w-md text-xs leading-5 text-[var(--color-pib-text-muted)]">
                          {forecastEmptyDescription}
                        </p>
                        {focusMode === 'noCloseDate' ? (
                          <button
                            type="button"
                            onClick={() => setFocusMode('all')}
                            className="btn-pib-secondary btn-pib-sm mt-3"
                            aria-label="Show full forecast"
                          >
                            <Icon name="filter_alt_off" />
                            Show full forecast
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowCreateDrawer(true)}
                            className="btn-pib-primary btn-pib-sm mt-3"
                          >
                            <Icon name="add" />
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
                        className="border-b border-[var(--color-pib-line)] last:border-0 hover:bg-[var(--color-row-hover)] transition-colors"
                      >
                        <td className="px-3 py-2 font-medium text-[var(--color-pib-text)]">
                          <Link
                            href={dealPortalPath(`/portal/deals/${deal.id}`)}
                            className="hover:text-[var(--color-accent-text)] transition-colors"
                          >
                            {dealTitle}
                          </Link>
                        </td>
                        <td
                          className="px-3 py-2 text-[var(--color-pib-text-muted)] hidden md:table-cell"
                          data-impeccable-disable="content-invisible-at-rest"
                        >
                          {stageLabel}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtDealValue(deal.value, deal.currency)}</td>
                        <td className="px-3 py-2 text-right">
                          <ProbabilityInput deal={deal} onUpdate={handleProbabilityUpdate} />
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--color-accent-text)]">
                          {fmtDealValue(weighted, deal.currency)}
                        </td>
                        <td
                          className="px-3 py-2 text-right text-[var(--color-pib-text-muted)] hidden lg:table-cell"
                          data-impeccable-disable="content-invisible-at-rest"
                        >
                          <button
                            type="button"
                            onClick={() => setEditingDeal(deal)}
                            aria-label={`${deal.expectedCloseDate ? 'Edit' : 'Add'} close date for ${dealTitle} from forecast`}
                            className="inline-flex rounded-md border border-transparent px-1 py-0.5 text-right transition-colors hover:border-[var(--color-accent-v2)] hover:text-[var(--color-pib-text)]"
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
          orgId={routeScope.orgId ?? ''}
          orgScope={routeScope}
        />
      )}

      {/* A5: Edit deal drawer */}
      {editingDeal && (
        <DealDrawer
          deal={editingDeal}
          defaultContactLabel={contactLabelsById[editingDeal.contactId]}
          onSaved={handleDealSaved}
          onClose={() => setEditingDeal(null)}
          orgId={editingDeal.orgId ?? routeScope.orgId ?? ''}
          orgScope={routeScope}
        />
      )}

      {/* A5: Deal detail drawer */}
      {viewingDeal && !editingDeal && (
        <DealDetailDrawer
          deal={viewingDeal}
          stages={stages}
          orgId={viewingDeal.orgId ?? routeScope.orgId ?? ''}
          orgScope={routeScope}
          contactLabel={contactLabelsById[viewingDeal.contactId]}
          contactHrefForDeal={(deal) => dealPortalPath(`/portal/contacts/${deal.contactId}`)}
          companyHrefForDeal={(deal) => dealPortalPath(`/portal/companies/${deal.companyId}`)}
          onClose={() => setViewingDeal(null)}
          onEdit={() => { setEditingDeal(viewingDeal); setViewingDeal(null) }}
        />
      )}
    </div>
  )
}

// Helper: fallback color by stage kind when no custom color is set
function stageColorByKind(kind?: string): string {
  if (kind === 'won') return 'var(--color-accent-v2)'
  if (kind === 'lost') return 'var(--color-accent-text)'
  return 'var(--color-accent-v2)'
}
