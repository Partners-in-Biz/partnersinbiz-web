'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Sequence, SequenceStatus, SequenceStep } from '@/lib/sequences/types'

type ViewFilter = 'all' | 'active' | 'paused' | 'draft' | 'needs-work'
type ChannelFilter = 'all' | 'email' | 'sms' | 'mixed'

const STATUS_META: Record<SequenceStatus, { label: string; icon: string; className: string }> = {
  draft: {
    label: 'Draft',
    icon: 'draft',
    className: 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text-muted)]',
  },
  active: {
    label: 'Active',
    icon: 'play_arrow',
    className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  },
  paused: {
    label: 'Paused',
    icon: 'pause',
    className: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  },
}

function stepChannel(step: SequenceStep) {
  return step.channel === 'sms' ? 'sms' : 'email'
}

function stepReady(step: SequenceStep) {
  if (stepChannel(step) === 'sms') return Boolean(step.smsBody?.trim())
  return Boolean(step.subject?.trim() && (step.bodyHtml?.trim() || step.bodyText?.trim()))
}

function sequenceGaps(sequence: Sequence): string[] {
  const gaps: string[] = []
  if (!sequence.name?.trim()) gaps.push('name')
  if (!sequence.description?.trim()) gaps.push('purpose')
  if (!sequence.steps.length) gaps.push('step')
  sequence.steps.forEach((step, index) => {
    if (!stepReady(step)) gaps.push(`step ${index + 1} content`)
    if (!Number.isFinite(Number(step.delayDays)) || Number(step.delayDays) < 0) gaps.push(`step ${index + 1} timing`)
  })
  if (sequence.status === 'active' && sequence.steps.length === 0) gaps.push('active journey')
  return Array.from(new Set(gaps))
}

function readinessScore(sequence: Sequence) {
  const checks = [
    Boolean(sequence.name?.trim()),
    Boolean(sequence.description?.trim()),
    sequence.steps.length > 0,
    sequence.steps.every(stepReady),
    sequence.steps.some((step) => step.delayDays > 0) || sequence.steps.length === 1,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function channelsFor(sequence: Sequence): ChannelFilter {
  const channels = new Set(sequence.steps.map(stepChannel))
  if (channels.size > 1) return 'mixed'
  if (channels.has('sms')) return 'sms'
  return 'email'
}

function cadenceLabel(sequence: Sequence) {
  if (!sequence.steps.length) return 'No cadence'
  const totalDays = sequence.steps.reduce((sum, step) => sum + Math.max(0, Number(step.delayDays) || 0), 0)
  if (totalDays === 0) return 'Same day'
  if (totalDays === 1) return '1 day'
  return `${totalDays} days`
}

function firstStepPreview(sequence: Sequence) {
  const first = sequence.steps[0]
  if (!first) return 'No first step configured'
  if (stepChannel(first) === 'sms') return first.smsBody?.trim() || 'SMS copy missing'
  return first.subject?.trim() || 'Email subject missing'
}

function StatusBadge({ status }: { status: SequenceStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${meta.className}`}>
      <span className="material-symbols-outlined text-[13px]">{meta.icon}</span>
      {meta.label}
    </span>
  )
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card min-h-[124px]">
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

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ViewFilter>('all')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/sequences')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const list: Sequence[] = body.data?.sequences ?? body.data ?? []
        setSequences(Array.isArray(list) ? list : [])
      })
      .catch(() => setFetchError('Failed to load sequences. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    const active = sequences.filter((sequence) => sequence.status === 'active').length
    const paused = sequences.filter((sequence) => sequence.status === 'paused').length
    const draft = sequences.filter((sequence) => sequence.status === 'draft').length
    const steps = sequences.reduce((sum, sequence) => sum + sequence.steps.length, 0)
    const sms = sequences.filter((sequence) => channelsFor(sequence) === 'sms' || channelsFor(sequence) === 'mixed').length
    const needsWork = sequences.filter((sequence) => sequenceGaps(sequence).length > 0).length
    const averageReadiness = sequences.length
      ? Math.round(sequences.reduce((sum, sequence) => sum + readinessScore(sequence), 0) / sequences.length)
      : 0
    return { active, paused, draft, steps, sms, needsWork, averageReadiness }
  }, [sequences])

  const visibleSequences = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sequences.filter((sequence) => {
      if (filter !== 'all' && filter !== 'needs-work' && sequence.status !== filter) return false
      if (filter === 'needs-work' && sequenceGaps(sequence).length === 0) return false
      if (channelFilter !== 'all' && channelsFor(sequence) !== channelFilter) return false
      if (!query) return true
      return [
        sequence.name,
        sequence.description,
        firstStepPreview(sequence),
        ...sequence.steps.map((step) => step.subject || step.smsBody || step.bodyText),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [channelFilter, filter, search, sequences])

  const journeyBlueprint = [
    {
      label: 'First touch',
      value: 'Confirm enquiry',
      icon: 'mark_email_read',
      copy: 'Acknowledge every new lead quickly so no employee has to remember the first follow-up manually.',
    },
    {
      label: 'Sales action',
      value: 'Prompt next step',
      icon: 'flag',
      copy: 'Move the contact toward a call, quote, or deal update instead of letting conversations stall.',
    },
    {
      label: 'Employee consistency',
      value: 'Shared playbook',
      icon: 'groups',
      copy: 'Give the whole team the same journey language while still letting admins refine the workflow.',
    },
    {
      label: 'Automation ready',
      value: 'Enroll contacts',
      icon: 'auto_mode',
      copy: 'Prepare journeys that can connect to CRM automation rules and contact enrollment panels.',
    },
  ]

  async function handleToggle(seq: Sequence) {
    if (togglingId) return
    const newStatus: SequenceStatus = seq.status === 'active' ? 'paused' : 'active'

    setSequences((prev) =>
      prev.map((s) => (s.id === seq.id ? { ...s, status: newStatus } : s))
    )
    setTogglingId(seq.id)

    try {
      const res = await fetch(`/api/v1/crm/sequences/${seq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
    } catch {
      setSequences((prev) =>
        prev.map((s) => (s.id === seq.id ? { ...s, status: seq.status } : s))
      )
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(seq: Sequence) {
    if (!window.confirm('Delete this sequence? This cannot be undone.')) return
    setDeletingId(seq.id)
    try {
      const res = await fetch(`/api/v1/crm/sequences/${seq.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      setSequences((prev) => prev.filter((s) => s.id !== seq.id))
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  function clearViewFilters() {
    setFilter('all')
    setChannelFilter('all')
    setSearch('')
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">CRM journeys</p>
          <h1 className="pib-page-title mt-2">Sequence command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Build and monitor multi-step email and SMS journeys that turn captured contacts into followed-up opportunities.
          </p>
        </div>
        <Link
          href="/portal/settings/sequences/new"
          className="btn-pib-accent flex w-fit shrink-0 items-center gap-1.5 text-sm"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New sequence
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active journeys" value={String(stats.active)} sub={`${stats.paused} paused, ${stats.draft} draft`} icon="route" />
        <StatCard label="Journey steps" value={String(stats.steps)} sub="Touchpoints across all sequences" icon="format_list_numbered" />
        <StatCard label="Multi-channel" value={String(stats.sms)} sub="Sequences using SMS or mixed channels" icon="forum" />
        <StatCard label="Readiness" value={`${stats.averageReadiness}%`} sub={`${stats.needsWork} sequence${stats.needsWork === 1 ? '' : 's'} need detail`} icon="task_alt" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <aside className="space-y-5">
          <div className="bento-card !p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Journey view</h2>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                Find sequence gaps by status, channel, first touch, or content.
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search sequences..."
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
            />
            <div className="grid grid-cols-2 gap-2">
              {[
                ['all', 'All'],
                ['active', 'Active'],
                ['paused', 'Paused'],
                ['draft', 'Draft'],
                ['needs-work', 'Needs work'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id as ViewFilter)}
                  className={[
                    'cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    filter === id
                      ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-text)]'
                      : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.03]',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bento-card !p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Channel focus</h2>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Check whether journeys are email-only, SMS, or mixed.</p>
            </div>
            {[
              ['all', 'All channels', 'All configured sequences'],
              ['email', 'Email', 'Email-only journeys'],
              ['sms', 'SMS', 'SMS-only journeys'],
              ['mixed', 'Mixed', 'Email plus SMS'],
            ].map(([id, label, sub]) => (
              <button
                key={id}
                type="button"
                onClick={() => setChannelFilter(id as ChannelFilter)}
                className={[
                  'cursor-pointer flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  channelFilter === id
                    ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                    : 'border-[var(--color-pib-line)] hover:bg-white/[0.03]',
                ].join(' ')}
              >
                <span>
                  <span className="block text-xs font-medium">{label}</span>
                  <span className="block text-[10px] text-[var(--color-pib-text-muted)]">{sub}</span>
                </span>
                <span className="text-xs text-[var(--color-pib-text-muted)]">
                  {id === 'all' ? sequences.length : sequences.filter((sequence) => channelsFor(sequence) === id).length}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section>
          {loading ? (
            <div className="bento-card !p-6">
              <p className="text-sm text-[var(--color-pib-text-muted)]">Loading sequences...</p>
            </div>
          ) : fetchError ? (
            <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {fetchError}
            </div>
          ) : sequences.length === 0 ? (
            <div className="bento-card !p-0 overflow-hidden">
              <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
                <div className="border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
                  <span className="material-symbols-outlined mb-4 block text-[34px] text-[var(--color-accent-v2)]">route</span>
                  <p className="eyebrow !text-[10px]">Journey setup</p>
                  <h2 className="mt-2 font-display text-2xl leading-tight text-[var(--color-pib-text)]">
                    Launch your first follow-up journey
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    Start with the customer journey your team repeats most often. A clear sequence turns first response,
                    sales prompts, and handover expectations into a company playbook rather than individual memory.
                  </p>
                  <Link
                    href="/portal/settings/sequences/new"
                    className="btn-pib-accent mt-5 inline-flex w-fit items-center gap-1.5 text-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Create the first sequence
                  </Link>
                </div>

                <div className="grid gap-px bg-[var(--color-pib-line)] sm:grid-cols-2">
                  {journeyBlueprint.map((item) => (
                    <div key={item.label} className="bg-[var(--color-pib-surface)] p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-pib-text-muted)]">{item.label}</p>
                          <p className="mt-2 font-display text-xl leading-none text-[var(--color-pib-text)]">{item.value}</p>
                        </div>
                        <span className="material-symbols-outlined text-[21px] text-[var(--color-pib-text-muted)]">{item.icon}</span>
                      </div>
                      <p className="mt-4 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : visibleSequences.length === 0 ? (
            <div className="bento-card !p-8 text-center">
              <span className="material-symbols-outlined mb-2 block text-3xl text-[var(--color-pib-text-muted)]" aria-hidden="true">manage_search</span>
              <p className="eyebrow !text-[10px]">Filtered journey view</p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">No sequences match this view.</h2>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Clear the sequence filters to return to every journey.</p>
              <button
                type="button"
                onClick={clearViewFilters}
                className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5 text-xs"
                aria-label="Show all sequences"
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">filter_alt_off</span>
                Show all sequences
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleSequences.map((seq) => {
                const isToggling = togglingId === seq.id
                const isDeleting = deletingId === seq.id
                const gaps = sequenceGaps(seq)
                const score = readinessScore(seq)
                const channel = channelsFor(seq)

                return (
                  <article
                    key={seq.id}
                    className={[
                      'bento-card !p-0 overflow-hidden transition-colors hover:border-[var(--color-pib-accent)]',
                      isDeleting ? 'opacity-50 pointer-events-none' : '',
                    ].join(' ')}
                  >
                    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)_auto]">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <StatusBadge status={seq.status} />
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                            {seq.steps.length} step{seq.steps.length === 1 ? '' : 's'}
                          </span>
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                            {cadenceLabel(seq)}
                          </span>
                          <span className={score >= 80 ? 'rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300' : 'rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-300'}>
                            {score}% ready
                          </span>
                        </div>
                        <h2 className="truncate text-base font-semibold">{seq.name}</h2>
                        {seq.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--color-pib-text-muted)]">{seq.description}</p>
                        ) : (
                          <p className="mt-1 text-xs text-amber-300">Purpose missing</p>
                        )}
                        <div className="mt-4 rounded-lg border border-[var(--color-pib-line)] bg-black/10 px-3 py-3">
                          <p className="eyebrow !text-[10px]">First touch</p>
                          <p className="mt-2 truncate text-sm">{firstStepPreview(seq)}</p>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="eyebrow !text-[10px] mb-2">Journey path</p>
                        <div className="space-y-2">
                          {seq.steps.slice(0, 4).map((step, index) => (
                            <div key={`${seq.id}-${index}`} className="flex items-center gap-3 rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-pib-line)] text-[10px]">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">
                                  {stepChannel(step) === 'sms' ? step.smsBody || 'SMS body missing' : step.subject || 'Subject missing'}
                                </p>
                                <p className="text-[10px] text-[var(--color-pib-text-muted)]">
                                  {stepChannel(step).toUpperCase()} · day {Math.max(0, Number(step.delayDays) || 0)}
                                </p>
                              </div>
                              <span className={stepReady(step) ? 'h-2 w-2 rounded-full bg-emerald-400' : 'h-2 w-2 rounded-full bg-amber-400'} />
                            </div>
                          ))}
                        </div>
                        {seq.steps.length > 4 && (
                          <p className="mt-2 text-[11px] text-[var(--color-pib-text-muted)]">+{seq.steps.length - 4} more steps</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                            {channel === 'mixed' ? 'Email + SMS' : channel.toUpperCase()}
                          </span>
                          {seq.goals?.length ? (
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">
                              {seq.goals.length} goal{seq.goals.length === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                              No exit goal
                            </span>
                          )}
                        </div>
                        {gaps.length > 0 && (
                          <p className="mt-3 text-[11px] text-amber-300">Needs: {gaps.join(', ')}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-end">
                        <button
                          type="button"
                          onClick={() => handleToggle(seq)}
                          disabled={isToggling || seq.status === 'draft'}
                          title={
                            seq.status === 'draft'
                              ? 'Edit the draft before activating'
                              : seq.status === 'active'
                                ? 'Pause sequence'
                                : 'Activate sequence'
                          }
                          className={[
                            'cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            seq.status === 'active'
                              ? 'border-amber-400/30 text-amber-300 hover:bg-amber-400/10'
                              : seq.status === 'paused'
                                ? 'border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10'
                                : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]',
                          ].join(' ')}
                        >
                          {isToggling ? '...' : seq.status === 'active' ? 'Pause' : seq.status === 'paused' ? 'Activate' : 'Draft'}
                        </button>

                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/portal/settings/sequences/${seq.id}/edit`}
                            title="Edit sequence"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
                          >
                            <span className="material-symbols-outlined text-[17px]">edit</span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(seq)}
                            disabled={isDeleting}
                            title="Delete sequence"
                            className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-red-400/[0.08] hover:text-red-400"
                          >
                            {isDeleting ? (
                              <span className="material-symbols-outlined text-[17px] animate-spin">progress_activity</span>
                            ) : (
                              <span className="material-symbols-outlined text-[17px]">delete</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
