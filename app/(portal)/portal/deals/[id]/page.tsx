'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import { DealDrawer } from '@/components/crm/DealDrawer'
import { lineItemDisplayTotal, lineItemsDisplayTotal } from '@/components/crm/dealFinancials'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Deal } from '@/lib/crm/types'

interface DealRecord {
  id?: string
  orgId?: string
  title?: string
  value?: number
  currency?: string
  pipelineId?: string
  stageId?: string
  probability?: number
  lostReason?: string
  contactId?: string
  companyId?: string
  companyName?: string
  expectedCloseDate?: unknown
  notes?: string
  ownerUid?: string
  ownerRef?: MemberRef
  lineItems?: Array<{
    name: string
    qty: number
    unitPrice: number
    discount?: number
    total: number
    currency: string
    productId?: string
  }>
  stageHistory?: Array<{
    pipelineId?: string
    stageId?: string
    enteredAt?: unknown
    enteredByRef?: MemberRef
  }>
  createdAt?: unknown
  updatedAt?: unknown
}

interface ActivityRecord {
  id: string
  type?: string
  summary?: string
  notes?: string
  createdAt?: unknown
  createdByRef?: MemberRef
}

type TeamMember = {
  uid: string
  firstName?: string
  lastName?: string
  displayName?: string
  email?: string
  jobTitle?: string
  role?: string
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'notes',
  email_sent: 'mail',
  email_received: 'inbox',
  sequence_enrolled: 'route',
  sequence_completed: 'route',
  contact_captured: 'add_circle',
  call: 'call',
  stage_change: 'swap_horiz',
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtValue(value: number | undefined, currency: string | undefined): string {
  if (value == null) return '—'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency ?? 'ZAR',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency ?? 'ZAR'} ${value.toLocaleString()}`
  }
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function closeDateLabel(value: unknown): string {
  const date = toDate(value)
  if (!date) return 'No close date'
  const diffDays = Math.ceil((date.getTime() - Date.now()) / 86400000)
  if (diffDays === 0) return 'Closes today'
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  return `Closes in ${diffDays}d`
}

function dateInputValue(value: unknown): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toISOString().slice(0, 10)
}

function probabilityColor(probability: number): string {
  if (probability >= 70) return '#4ade80'
  if (probability >= 40) return '#facc15'
  return '#f87171'
}

function clampProbability(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeStageName(name: string): string {
  return name.replace(/_/g, ' ')
}

function teamMemberLabel(member: TeamMember): string {
  const name = member.displayName || [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email || member.uid
  return member.jobTitle ? `${name} - ${member.jobTitle}` : name
}

function teamMemberDisplayName(member: TeamMember): string {
  return member.displayName || [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email || member.uid
}

function teamMemberOwnerRef(member: TeamMember): MemberRef {
  return {
    uid: member.uid,
    displayName: teamMemberDisplayName(member),
    ...(member.jobTitle ? { jobTitle: member.jobTitle } : {}),
    kind: 'human',
  }
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [deal, setDeal] = useState<DealRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [pipelineName, setPipelineName] = useState<string>('')
  const [stageName, setStageName] = useState<string>('')
  const [contactName, setContactName] = useState<string>('')

  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [ownerUid, setOwnerUid] = useState('')
  const [ownerPending, setOwnerPending] = useState(false)
  const [ownerError, setOwnerError] = useState('')
  const [probabilityInput, setProbabilityInput] = useState('')
  const [probabilityPending, setProbabilityPending] = useState(false)
  const [probabilityError, setProbabilityError] = useState('')
  const [closeDateInput, setCloseDateInput] = useState('')
  const [closeDatePending, setCloseDatePending] = useState(false)
  const [closeDateError, setCloseDateError] = useState('')

  const fetchDeal = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    setActivitiesLoading(true)
    setPipelineName('')
    setStageName('')
    setContactName('')

    try {
      const res = await fetch(`/api/v1/crm/deals/${id}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const d: DealRecord | null = body.data?.deal ?? body.deal ?? body.data ?? null
      if (!d) throw new Error('Deal not found')
      setDeal(d)
      setProbabilityInput(String(d.probability ?? 50))
      setCloseDateInput(dateInputValue(d.expectedCloseDate))
      setLoading(false)

      const secondaryFetches: Promise<void>[] = []

      if (d.pipelineId) {
        secondaryFetches.push(
          fetch(`/api/v1/crm/pipelines/${d.pipelineId}`)
            .then(r => r.json())
            .then(pb => {
              const pipeline = pb.data ?? pb
              setPipelineName(pipeline?.name ?? d.pipelineId ?? '')
              if (d.stageId && Array.isArray(pipeline?.stages)) {
                const stage = (pipeline.stages as Array<{ id: string; label: string }>).find(s => s.id === d.stageId)
                setStageName(stage?.label ?? d.stageId ?? '')
              }
            })
            .catch(() => {}),
        )
      }

      if (d.contactId) {
        secondaryFetches.push(
          fetch(`/api/v1/crm/contacts/${d.contactId}`)
            .then(r => r.json())
            .then(cb => {
              const contact = cb.data?.contact ?? cb.data ?? cb
              setContactName(contact?.name ?? contact?.email ?? '')
            })
            .catch(() => {}),
        )
        secondaryFetches.push(
          fetch(`/api/v1/crm/activities?contactId=${encodeURIComponent(d.contactId)}&limit=20`)
            .then(r => r.json())
            .then(ab => {
              setActivities(ab.data?.activities ?? ab.data ?? [])
              setActivitiesLoading(false)
            })
            .catch(() => setActivitiesLoading(false)),
        )
      } else {
        setActivitiesLoading(false)
      }

      await Promise.all(secondaryFetches)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deal')
      setLoading(false)
      setActivitiesLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchDeal()
  }, [fetchDeal])

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

  async function assignOwner() {
    if (!deal || !id) return
    const nextOwnerUid = ownerUid.trim()
    if (!nextOwnerUid) return
    const owner = teamMembers.find((member) => member.uid === nextOwnerUid)

    setOwnerPending(true)
    setOwnerError('')
    try {
      const res = await fetch(`/api/v1/crm/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUid: nextOwnerUid }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to assign owner')
      }
      setDeal({
        ...deal,
        ownerUid: nextOwnerUid,
        ownerRef: owner ? teamMemberOwnerRef(owner) : deal.ownerRef,
      })
      setOwnerUid('')
    } catch (err) {
      setOwnerError(err instanceof Error ? err.message : 'Failed to assign owner')
    } finally {
      setOwnerPending(false)
    }
  }

  async function updateProbability() {
    if (!deal || !id) return
    const nextProbability = clampProbability(Number(probabilityInput))
    setProbabilityPending(true)
    setProbabilityError('')
    try {
      const res = await fetch(`/api/v1/crm/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probability: nextProbability }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to update probability')
      }
      setDeal({
        ...deal,
        probability: nextProbability,
      })
      setProbabilityInput(String(nextProbability))
    } catch (err) {
      setProbabilityError(err instanceof Error ? err.message : 'Failed to update probability')
    } finally {
      setProbabilityPending(false)
    }
  }

  async function updateCloseDate() {
    if (!deal || !id) return
    const nextCloseDate = closeDateInput.trim()
    if (!nextCloseDate) return
    setCloseDatePending(true)
    setCloseDateError('')
    try {
      const res = await fetch(`/api/v1/crm/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedCloseDate: nextCloseDate }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to update close date')
      }
      setDeal({
        ...deal,
        expectedCloseDate: nextCloseDate,
      })
    } catch (err) {
      setCloseDateError(err instanceof Error ? err.message : 'Failed to update close date')
    } finally {
      setCloseDatePending(false)
    }
  }

  async function handleArchive() {
    if (!deal) return
    const confirmed = window.confirm(`Archive ${deal.title ?? 'this deal'}? The record will be hidden from active CRM views but activity history stays intact.`)
    if (!confirmed) return
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/crm/deals/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push('/portal/deals')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive deal')
      setDeleting(false)
    }
  }

  function handleSaved() {
    setEditOpen(false)
    void fetchDeal()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !deal) {
    return (
      <div className="bento-card !p-8 text-center space-y-3">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)] block">
          monetization_on
        </span>
        <p className="text-[var(--color-pib-text-muted)]">{error || 'Deal not found'}</p>
        <Link href="/portal/deals" className="text-sm text-[var(--color-pib-accent)] hover:underline">
          ← Back to Deals
        </Link>
      </div>
    )
  }

  const prob = deal.probability ?? 50
  const lineItemTotal = lineItemsDisplayTotal(deal.lineItems ?? [])
  const weightedValue = (deal.value ?? 0) * (prob / 100)
  const probColor = probabilityColor(prob)
  const isLost = Boolean(deal.lostReason || stageName.toLowerCase().includes('lost'))
  const isWon = stageName.toLowerCase().includes('won')
  const stageDisplay = stageName || deal.stageId || 'No stage'
  const stageHistory = (deal.stageHistory ?? []).slice(-5).reverse()
  const commandSignals = [
    deal.contactId ? 'Contact linked' : 'No contact',
    deal.companyId ? 'Company linked' : 'No company',
    (deal.lineItems?.length ?? 0) > 0 ? `${deal.lineItems?.length} line items` : 'No line items',
    deal.expectedCloseDate ? closeDateLabel(deal.expectedCloseDate) : 'Close date missing',
  ]

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/portal/deals"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
      >
        <span className="material-symbols-outlined text-[14px]">arrow_back</span>
        Deals
      </Link>

      {/* Command header */}
      <div className="bento-card !p-5 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow !text-[10px]">Deal command center</p>
            <h1 className="mt-1 font-display text-3xl font-bold leading-tight text-[var(--color-pib-text)]">{deal.title ?? '—'}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-label uppercase tracking-wide"
                style={{ background: `${probColor}20`, color: probColor }}
              >
                {prob}% probability
              </span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                {normalizeStageName(stageDisplay)}
              </span>
              {pipelineName && (
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  {pipelineName}
                </span>
              )}
              {isWon && <span className="rounded-full bg-green-400/15 px-2.5 py-1 text-[10px] font-label uppercase tracking-wide text-green-300">won</span>}
              {isLost && <span className="rounded-full bg-red-400/15 px-2.5 py-1 text-[10px] font-label uppercase tracking-wide text-red-300">risk/lost</span>}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {deal.contactId && (
              <Link href={`/portal/contacts/${deal.contactId}`} className="btn-pib-secondary inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">person</span>
                Contact
              </Link>
            )}
            {deal.companyId && (
              <Link href={`/portal/companies/${deal.companyId}`} className="btn-pib-secondary inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">domain</span>
                Company
              </Link>
            )}
            <button type="button" onClick={() => setEditOpen(true)} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">edit</span>
              Edit
            </button>
            <button
              type="button"
              onClick={handleArchive}
              disabled={deleting}
              className="cursor-pointer rounded-lg border border-red-400/30 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? 'Archiving...' : 'Archive'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Deal value', value: fmtValue(deal.value, deal.currency), icon: 'payments' },
            { label: 'Weighted', value: fmtValue(weightedValue, deal.currency), icon: 'query_stats' },
            { label: 'Close timing', value: closeDateLabel(deal.expectedCloseDate), icon: 'event_upcoming' },
            { label: 'Activity', value: activitiesLoading ? '...' : String(activities.length), icon: 'history' },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{tile.label}</p>
                <span className="material-symbols-outlined text-[17px] text-[var(--color-pib-text-muted)]">{tile.icon}</span>
              </div>
              <p className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">{tile.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Forecast confidence</p>
            <span className="font-mono text-sm" style={{ color: probColor }}>{prob}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${prob}%`, background: probColor }} />
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
            <div className="min-w-[180px] flex-1">
              <label htmlFor="dealForecastProbability" className="pib-label">Update forecast probability</label>
              <input
                id="dealForecastProbability"
                type="number"
                min={0}
                max={100}
                value={probabilityInput}
                onChange={(event) => setProbabilityInput(event.target.value)}
                className="pib-input mt-1"
              />
            </div>
            <button
              type="button"
              onClick={updateProbability}
              disabled={probabilityPending || probabilityInput.trim() === ''}
              className="pib-btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Update forecast probability for ${deal.title ?? 'this deal'}`}
            >
              <span className="material-symbols-outlined text-base">trending_up</span>
              {probabilityPending ? 'Updating...' : 'Update'}
            </button>
            <p className="basis-full text-xs leading-5 text-[var(--color-pib-text-muted)]">
              Adjust confidence after real buyer signals so the weighted forecast stays honest for leadership.
            </p>
            {probabilityError && <p className="basis-full text-xs text-red-300">{probabilityError}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="dealExpectedCloseDate" className="pib-label">Set expected close date</label>
            <input
              id="dealExpectedCloseDate"
              type="date"
              value={closeDateInput}
              onChange={(event) => setCloseDateInput(event.target.value)}
              className="pib-input mt-1"
            />
          </div>
          <button
            type="button"
            onClick={updateCloseDate}
            disabled={closeDatePending || closeDateInput.trim() === ''}
            className="pib-btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Update close date for ${deal.title ?? 'this deal'}`}
          >
            <span className="material-symbols-outlined text-base">event_upcoming</span>
            {closeDatePending ? 'Updating...' : 'Update'}
          </button>
          <p className="basis-full text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Keep pipeline velocity and month-end forecast timing visible before this opportunity stalls.
          </p>
          {closeDateError && <p className="basis-full text-xs text-red-300">{closeDateError}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {commandSignals.map((signal) => (
            <span key={signal} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--color-pib-text-muted)]">
              {signal}
            </span>
          ))}
        </div>

        {deal.lostReason && (
          <div
            className="rounded-[var(--radius-card)] px-4 py-2 text-sm"
            style={{ background: '#ef444415', color: '#f87171', border: '1px solid #ef444430' }}
          >
            Lost: {deal.lostReason}
          </div>
        )}
      </div>

      {/* 2-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left col */}
        <section className="lg:col-span-1">
          <div className="bento-card !p-5 space-y-4 text-sm">
            <p className="eyebrow !text-[10px]">Details</p>
            {pipelineName && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Pipeline</p>
                <p className="text-[var(--color-pib-text)] mt-0.5">{pipelineName}</p>
              </div>
            )}
            {deal.contactId && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Contact</p>
                <Link
                  href={`/portal/contacts/${deal.contactId}`}
                  className="text-[var(--color-pib-accent)] hover:underline mt-0.5 inline-block"
                >
                  {contactName || deal.contactId}
                </Link>
              </div>
            )}
            {deal.companyId && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Company</p>
                <Link
                  href={`/portal/companies/${deal.companyId}`}
                  className="text-[var(--color-pib-accent)] hover:underline mt-0.5 inline-block"
                >
                  {deal.companyName || deal.companyId}
                </Link>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Owner</p>
              <p className="text-[var(--color-pib-text)] mt-0.5">
                {deal.ownerRef?.displayName ?? deal.ownerUid ?? 'No owner assigned'}
              </p>
              <div className="mt-3 space-y-2 rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                <label htmlFor="dealDetailOwner" className="pib-label">Assign deal owner</label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id="dealDetailOwner"
                    value={ownerUid}
                    onChange={(event) => setOwnerUid(event.target.value)}
                    className="pib-select min-w-[220px] flex-1"
                  >
                    <option value="">Select a team member</option>
                    {teamMembers.map((member) => (
                      <option key={member.uid} value={member.uid}>
                        {teamMemberLabel(member)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={assignOwner}
                    disabled={!ownerUid.trim() || ownerPending}
                    className="pib-btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Assign owner to ${deal.title ?? 'this deal'}`}
                  >
                    <span className="material-symbols-outlined text-base">supervisor_account</span>
                    {ownerPending ? 'Assigning...' : 'Assign'}
                  </button>
                </div>
                <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Keep forecast and follow-up ownership tied to a real person before this opportunity moves.
                </p>
                {ownerError && <p className="text-xs text-red-300">{ownerError}</p>}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Close date</p>
              {deal.expectedCloseDate ? (
                <p className="text-[var(--color-pib-text-muted)] mt-0.5 font-mono text-xs">
                  {fmtTimestamp(deal.expectedCloseDate)}
                </p>
              ) : (
                <div className="mt-1 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                  <p className="text-sm font-semibold text-[var(--color-pib-text)]">No close date captured</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                    Set forecast timing so leadership can trust pipeline commitments.
                  </p>
                </div>
              )}
            </div>
            {deal.notes && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Notes</p>
                <p className="text-[var(--color-pib-text)] mt-0.5 whitespace-pre-wrap">{deal.notes}</p>
              </div>
            )}
          </div>

          <div className="mt-4 bento-card !p-5 space-y-4">
            <p className="eyebrow !text-[10px]">Next best actions</p>
            <div className="space-y-3">
              {[
                {
                  icon: deal.contactId ? 'mail' : 'person_add',
                  title: deal.contactId ? 'Follow up with the contact' : 'Link a decision-maker',
                  copy: deal.contactId ? 'Use the contact profile to send email, SMS, or schedule the next touch.' : 'A deal without a contact cannot drive reliable activity or automation.',
                },
                {
                  icon: deal.expectedCloseDate ? 'event_available' : 'event_busy',
                  title: deal.expectedCloseDate ? closeDateLabel(deal.expectedCloseDate) : 'Set a close date',
                  copy: deal.expectedCloseDate ? 'Keep the forecast honest by updating probability after each interaction.' : 'Forecast and pipeline velocity need an expected close date.',
                },
                {
                  icon: (deal.lineItems?.length ?? 0) > 0 ? 'request_quote' : 'playlist_add',
                  title: (deal.lineItems?.length ?? 0) > 0 ? 'Ready to quote' : 'Add line items',
                  copy: (deal.lineItems?.length ?? 0) > 0 ? 'Line items are captured, so this deal can move into quote creation.' : 'Products and services make the opportunity concrete and easier to approve.',
                },
              ].map((action) => (
                <div key={action.title} className="flex gap-3 rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                  <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{action.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{action.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{action.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 bento-card !p-5 space-y-3">
            <p className="eyebrow !text-[10px]">Stage movement</p>
            {stageHistory.length === 0 ? (
              <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-accent-v2)]"
                    >
                      timeline
                    </span>
                    <div>
                      <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                        Pipeline progress unproven
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Record the first stage signal</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                        Confirm the current stage now so leadership can trust the forecast, reps can see where the opportunity is stuck, and future stage changes have a baseline.
                      </p>
                    </div>
                  </div>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="pib-btn-primary inline-flex shrink-0 items-center gap-1.5 text-sm"
                  aria-label={`Confirm stage baseline for ${deal.title ?? 'this deal'}`}
                >
                  <span className="material-symbols-outlined text-base">sync_alt</span>
                  Confirm stage baseline
                </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {stageHistory.map((entry, index) => (
                  <div key={`${entry.pipelineId}-${entry.stageId}-${index}`} className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full" style={{ background: index === 0 ? probColor : 'var(--color-pib-text-muted)' }} />
                    <div>
                      <p className="text-sm text-[var(--color-pib-text)]">{normalizeStageName(entry.stageId ?? 'Stage')}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        {fmtTimestamp(entry.enteredAt)}{entry.enteredByRef?.displayName ? ` · ${entry.enteredByRef.displayName}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Right col */}
        <section className="lg:col-span-2 space-y-6">
          {/* Line items */}
          <div className="bento-card !p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow !text-[10px]">Line items</p>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Products, services, and quote-ready commercial detail.</p>
              </div>
              <button type="button" onClick={() => setEditOpen(true)} className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs">
                <span className="material-symbols-outlined text-[14px]">edit</span>
                Edit items
              </button>
            </div>
            {(deal.lineItems?.length ?? 0) > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-pib-line)' }}>
                    {['Item', 'Qty', 'Unit price', 'Total'].map(h => (
                      <th
                        key={h}
                        className="text-left text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] px-4 py-2.5"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(deal.lineItems ?? []).map((li, i) => (
                    <tr
                      key={i}
                      className="border-b last:border-0"
                      style={{ borderColor: 'var(--color-pib-line)' }}
                    >
                      <td className="px-4 py-3 text-[var(--color-pib-text)]">{li.name}</td>
                      <td className="px-4 py-3 font-mono text-[var(--color-pib-text-muted)]">{li.qty}</td>
                      <td className="px-4 py-3 font-mono text-[var(--color-pib-text-muted)]">
                        {fmtValue(li.unitPrice, li.currency || deal.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--color-pib-text)]">
                        {fmtValue(lineItemDisplayTotal(li), li.currency || deal.currency)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--color-pib-surface)' }}>
                    <td colSpan={3} className="px-4 py-3 text-xs font-bold text-[var(--color-pib-text-muted)] uppercase tracking-widest">
                      Total
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[var(--color-pib-text)]">
                      {fmtValue(lineItemTotal, deal.currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="p-10">
                <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-accent-v2)]"
                  >
                    request_quote
                  </span>
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Commercial detail missing
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Make this deal quote-ready</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      Add products, services, or ad-hoc pricing so leadership can review value, delivery can see scope, and the opportunity can become a client-ready quote.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="pib-btn-primary mt-4 inline-flex items-center gap-1.5 text-sm"
                    aria-label={`Add first commercial item to ${deal.title ?? 'this deal'}`}
                  >
                    <span className="material-symbols-outlined text-base">playlist_add</span>
                    Add first commercial item
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Activity */}
          <div className="pib-card-section">
            <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between">
              <p className="eyebrow !text-[10px]">Activity</p>
              <span className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                {activitiesLoading ? '…' : `${activities.length} record${activities.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {activitiesLoading ? (
              <div className="p-5 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="pib-skeleton h-10" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="p-10">
                <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-accent-v2)]"
                  >
                    history
                  </span>
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Relationship trail missing
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Anchor the first deal activity</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      Link a contact before the first note, email, call, or meeting so every employee can see who owns the conversation and what happened next.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="pib-btn-primary mt-4 inline-flex items-center gap-1.5 text-sm"
                    aria-label={`Link contact and start activity for ${deal.title ?? 'this deal'}`}
                  >
                    <span className="material-symbols-outlined text-base">person_add</span>
                    Link contact and start activity
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 pb-4">
                {activities.map(a => (
                  <div key={a.id} className="flex gap-3 py-3 border-b border-[var(--color-pib-line)] last:border-0">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)]">
                        {ACTIVITY_ICONS[String(a.type ?? '')] ?? 'circle'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-pib-text)]">{a.summary ?? a.notes ?? a.type}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                        {a.createdByRef?.displayName ?? 'System'} · {fmtTimestamp(a.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {editOpen && (
        <DealDrawer
          deal={deal as Deal}
          defaultContactLabel={contactName}
          onSaved={handleSaved}
          onClose={() => setEditOpen(false)}
          orgId={deal.orgId ?? ''}
        />
      )}
    </div>
  )
}
