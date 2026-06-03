'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ActionType, AutomationAction, AutomationRule, TriggerEvent } from '@/lib/automations/types'

type ViewFilter = 'all' | 'active' | 'paused' | 'needs-work'

const TRIGGER_META: Record<TriggerEvent, { label: string; icon: string; group: string; sub: string }> = {
  'deal.created': {
    label: 'Deal created',
    icon: 'add_business',
    group: 'Pipeline',
    sub: 'Starts when a new opportunity enters CRM.',
  },
  'deal.stage_changed': {
    label: 'Deal stage changed',
    icon: 'move_group',
    group: 'Pipeline',
    sub: 'Runs when an opportunity moves stage.',
  },
  'deal.won': {
    label: 'Deal won',
    icon: 'trophy',
    group: 'Revenue',
    sub: 'Runs after a deal reaches a won stage.',
  },
  'deal.lost': {
    label: 'Deal lost',
    icon: 'do_not_disturb_on',
    group: 'Revenue',
    sub: 'Runs after a deal reaches a lost stage.',
  },
  'contact.created': {
    label: 'Contact created',
    icon: 'person_add',
    group: 'Contacts',
    sub: 'Runs when a new lead or customer is added.',
  },
  'contact.lifecycle_changed': {
    label: 'Contact lifecycle changed',
    icon: 'published_with_changes',
    group: 'Contacts',
    sub: 'Runs when lifecycle stage changes.',
  },
}

const ACTION_META: Record<ActionType, { label: string; icon: string; tone: string }> = {
  send_email: { label: 'Email', icon: 'mail', tone: 'text-sky-300 border-sky-400/20 bg-sky-400/10' },
  send_notification: { label: 'Notify', icon: 'notifications', tone: 'text-amber-300 border-amber-400/20 bg-amber-400/10' },
  assign_owner: { label: 'Assign', icon: 'assignment_ind', tone: 'text-violet-300 border-violet-400/20 bg-violet-400/10' },
  dispatch_webhook: { label: 'Webhook', icon: 'webhook', tone: 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10' },
  enroll_in_sequence: { label: 'Sequence', icon: 'send_time_extension', tone: 'text-rose-300 border-rose-400/20 bg-rose-400/10' },
}

const automationBlueprint = [
  {
    label: 'Trigger',
    value: 'CRM signal',
    icon: 'bolt',
    copy: 'Pick the contact, deal, or stage movement that must never wait for someone to remember it.',
  },
  {
    label: 'Action',
    value: 'Team response',
    icon: 'account_tree',
    copy: 'Notify, assign, email, enroll, or webhook the next system so work moves without manual chasing.',
  },
  {
    label: 'Owner handoff',
    value: 'No dropped work',
    icon: 'assignment_ind',
    copy: 'Make responsibility obvious for managers and employees when opportunities change state.',
  },
  {
    label: 'Audit trail',
    value: 'Governed growth',
    icon: 'history',
    copy: 'Keep every rule visible, reviewable, and ready to tune as the company scales.',
  },
]

function triggerLabel(rule: AutomationRule): string {
  let label = TRIGGER_META[rule.trigger.event]?.label ?? rule.trigger.event
  if (rule.trigger.toStageId) label += ' to stage'
  if (rule.trigger.pipelineId) label += ' in pipeline'
  return label
}

function delayLabel(minutes?: number): string {
  if (!minutes) return 'Immediate'
  if (minutes < 60) return `After ${minutes}m`
  if (minutes < 1440) return `After ${Math.round(minutes / 60)}h`
  return `After ${Math.round(minutes / 1440)}d`
}

function actionDetail(action: AutomationAction): string {
  switch (action.type) {
    case 'send_email':
      return action.emailSubject?.trim() || 'Email draft'
    case 'send_notification':
      return action.notificationMessage?.trim() || 'Team notification'
    case 'assign_owner':
      if (action.ownerDisplayName?.trim()) return action.ownerDisplayName
      if (action.ownerUid?.trim()) return 'Owner identity missing'
      return 'Owner assignment'
    case 'dispatch_webhook':
      return action.webhookUrl || 'External endpoint'
    case 'enroll_in_sequence':
      if (action.sequenceName?.trim()) return action.sequenceName
      if (action.sequenceId?.trim()) return 'Sequence identity missing'
      return 'Sequence enrollment'
    default:
      return 'Action'
  }
}

function ruleGaps(rule: AutomationRule): string[] {
  const gaps: string[] = []
  if (!rule.name?.trim()) gaps.push('name')
  if (!rule.actions.length) gaps.push('action')
  if (rule.trigger.event === 'deal.stage_changed' && !rule.trigger.toStageId) gaps.push('stage filter')

  rule.actions.forEach((action) => {
    if (action.type === 'send_email' && (!action.emailSubject?.trim() || !action.emailBody?.trim())) gaps.push('email content')
    if (action.type === 'send_notification' && !action.notificationMessage?.trim()) gaps.push('notification copy')
    if (action.type === 'assign_owner' && !action.ownerUid?.trim()) gaps.push('owner')
    if (action.type === 'dispatch_webhook' && !action.webhookUrl?.trim()) gaps.push('webhook URL')
    if (action.type === 'enroll_in_sequence' && !action.sequenceId?.trim()) gaps.push('sequence')
  })

  return Array.from(new Set(gaps))
}

function ruleScore(rule: AutomationRule): number {
  const gaps = ruleGaps(rule).length
  return Math.max(0, Math.round(((5 - Math.min(gaps, 5)) / 5) * 100))
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

function ActionChip({ action }: { action: AutomationAction }) {
  const meta = ACTION_META[action.type]
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${meta.tone}`}>
      <span className="material-symbols-outlined text-[13px] shrink-0">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pendingDeleteRule, setPendingDeleteRule] = useState<AutomationRule | null>(null)
  const [filter, setFilter] = useState<ViewFilter>('all')
  const [search, setSearch] = useState('')

  const fetchAutomationRules = useCallback(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/automations')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${r.status}`)
        }
        return body
      })
      .then((body) => {
        const list: AutomationRule[] = body.data?.rules ?? body.data ?? body ?? []
        setRules(Array.isArray(list) ? list : [])
      })
      .catch((error: unknown) => {
        setRules([])
        setFetchError(error instanceof Error ? error.message : 'Failed to load automations. Please try again.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchAutomationRules()
  }, [fetchAutomationRules])

  const stats = useMemo(() => {
    const active = rules.filter((rule) => rule.enabled).length
    const delayed = rules.filter((rule) => Boolean(rule.delayMinutes)).length
    const needsWork = rules.filter((rule) => ruleGaps(rule).length > 0).length
    const actions = rules.reduce((sum, rule) => sum + rule.actions.length, 0)
    const eventCoverage = new Set(rules.map((rule) => rule.trigger.event)).size

    return { active, paused: rules.length - active, delayed, needsWork, actions, eventCoverage }
  }, [rules])

  const visibleRules = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rules.filter((rule) => {
      if (filter === 'active' && !rule.enabled) return false
      if (filter === 'paused' && rule.enabled) return false
      if (filter === 'needs-work' && ruleGaps(rule).length === 0) return false
      if (!query) return true
      return [
        rule.name,
        rule.description,
        triggerLabel(rule),
        ...rule.actions.map(actionDetail),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [filter, rules, search])

  async function handleToggle(rule: AutomationRule) {
    if (togglingId) return
    const newEnabled = !rule.enabled

    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: newEnabled } : r))
    )
    setTogglingId(rule.id)

    try {
      const res = await fetch(`/api/v1/crm/automations/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
    } catch {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r))
      )
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(rule: AutomationRule) {
    setDeleteError(null)
    setDeletingId(rule.id)
    try {
      const res = await fetch(`/api/v1/crm/automations/${rule.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
      setPendingDeleteRule(null)
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  async function confirmDeleteRule() {
    if (!pendingDeleteRule) return
    await handleDelete(pendingDeleteRule)
  }

  function clearViewFilters() {
    setFilter('all')
    setSearch('')
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">CRM operations</p>
          <h1 className="pib-page-title mt-2">Automation command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Design, monitor, and tune the CRM rules that react to contact and deal movement without leaving gaps in follow-up.
          </p>
        </div>
        <Link
          href="/portal/settings/automations/new"
          className="btn-pib-accent flex w-fit shrink-0 items-center gap-1.5 text-sm"
          aria-label="New automation"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          New automation
        </Link>
      </div>

      {!fetchError && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Live rules" value={String(stats.active)} sub={`${stats.paused} paused for review`} icon="bolt" />
          <StatCard label="Event coverage" value={`${stats.eventCoverage}/6`} sub="CRM triggers with at least one rule" icon="hub" />
          <StatCard label="Workflow actions" value={String(stats.actions)} sub={`${stats.delayed} delayed handoffs configured`} icon="account_tree" />
          <StatCard label="Needs work" value={String(stats.needsWork)} sub="Rules missing useful execution details" icon="rule_settings" />
        </div>
      )}

      <div className={fetchError ? '' : 'grid gap-5 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]'}>
        {!fetchError && (
        <aside className="space-y-5">
          <div className="bento-card !p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Operating view</h2>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                Segment rules by state, then search by trigger, message, owner, sequence, or endpoint.
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search automations..."
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
            />
            <div className="grid grid-cols-2 gap-2">
              {[
                ['all', 'All'],
                ['active', 'Active'],
                ['paused', 'Paused'],
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

          <div className="bento-card !p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Trigger map</h2>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Coverage across CRM events.</p>
              </div>
              <span className="text-[10px] rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[var(--color-pib-text-muted)]">
                {stats.eventCoverage} active
              </span>
            </div>
            <div className="space-y-2">
              {(Object.entries(TRIGGER_META) as Array<[TriggerEvent, (typeof TRIGGER_META)[TriggerEvent]]>).map(([event, meta]) => {
                const count = rules.filter((rule) => rule.trigger.event === event).length
                return (
                  <div key={event} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">{meta.icon}</span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{meta.label}</p>
                        <p className="truncate text-[10px] text-[var(--color-pib-text-muted)]">{meta.group}</p>
                      </div>
                    </div>
                    <span className={count > 0 ? 'text-xs text-emerald-300' : 'text-xs text-[var(--color-pib-text-muted)]'}>
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>
        )}

        <section>
          {deleteError && (
            <div className="mb-3 rounded-lg border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {deleteError}
            </div>
          )}

          {loading ? (
            <div className="bento-card !p-6">
              <p className="text-sm text-[var(--color-pib-text-muted)]">Loading automations...</p>
            </div>
          ) : fetchError ? (
            <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
                  <div>
                    <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                    <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                      Automation rules could not load
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{fetchError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={fetchAutomationRules}
                  className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
                  aria-label="Retry loading automation rules"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
                  Retry
                </button>
              </div>
            </section>
          ) : rules.length === 0 ? (
            <div className="bento-card !p-0 overflow-hidden">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
                <div className="flex flex-col justify-between gap-8 border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
                  <div>
                    <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                      <span className="material-symbols-outlined text-[22px]">account_tree</span>
                    </span>
                    <p className="eyebrow !text-[10px]">Automation setup</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-normal text-[var(--color-pib-text)]">
                      Launch your first CRM safety net
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      Start with the highest-risk handoff in the business: new lead assignment, stage-change notifications, win/loss follow-up, or a webhook into the next operating system. The goal is simple: every employee knows what happens next.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/portal/settings/automations/new"
                      className="btn-pib-accent flex w-fit items-center gap-1.5 text-sm"
                      aria-label="Create the first automation"
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                      Create the first automation
                    </Link>
                    <span className="rounded-full border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)]">
                      Start with one rule, then expand coverage
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  {automationBlueprint.map((item) => (
                    <div key={item.label} className="rounded-xl border border-[var(--color-pib-line)] bg-black/10 p-4">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[var(--color-pib-text)]">
                          <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                        </span>
                        <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                          {item.value}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">{item.label}</h3>
                      <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : visibleRules.length === 0 ? (
            <div className="bento-card !p-8 text-center">
              <span className="material-symbols-outlined mb-2 block text-3xl text-[var(--color-pib-text-muted)]" aria-hidden="true">manage_search</span>
              <p className="eyebrow !text-[10px]">Filtered automation view</p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">No automations match this view.</h2>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Clear the automation filters to return to every CRM rule.</p>
              <button
                type="button"
                onClick={clearViewFilters}
                className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5 text-xs"
                aria-label="Show all automations"
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">filter_alt_off</span>
                Show all automations
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDeleteRule && (
                <section
                  role="alertdialog"
                  aria-labelledby="automation-delete-confirm-title"
                  aria-describedby="automation-delete-confirm-description"
                  className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 shadow-xl"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <span className="material-symbols-outlined mt-0.5 text-red-300" aria-hidden="true">
                        warning
                      </span>
                      <div className="min-w-0">
                        <p className="eyebrow !text-[10px] text-red-200">Automation delete confirmation</p>
                        <h2 id="automation-delete-confirm-title" className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                          Delete automation &quot;{pendingDeleteRule.name}&quot;?
                        </h2>
                        <p id="automation-delete-confirm-description" className="mt-2 text-sm text-red-100/90">
                          This removes the CRM safety net for {pendingDeleteRule.trigger.event} and stops {pendingDeleteRule.actions.length} workflow {pendingDeleteRule.actions.length === 1 ? 'action' : 'actions'} from running. Existing CRM history stays available for audit.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDeleteRule(null)
                          setDeleteError(null)
                        }}
                        className="btn-pib-secondary text-xs"
                        disabled={deletingId !== null}
                        aria-label={`Cancel delete for automation ${pendingDeleteRule.name}`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmDeleteRule}
                        disabled={deletingId !== null}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
                        aria-label={`Confirm delete automation ${pendingDeleteRule.name}`}
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          delete
                        </span>
                        {deletingId === pendingDeleteRule.id ? 'Deleting...' : 'Delete automation'}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {visibleRules.map((rule) => {
                const isToggling = togglingId === rule.id
                const isDeleting = deletingId === rule.id
                const triggerMeta = TRIGGER_META[rule.trigger.event]
                const gaps = ruleGaps(rule)
                const score = ruleScore(rule)

                return (
                  <article
                    key={rule.id}
                    className={[
                      'bento-card !p-0 overflow-hidden transition-colors hover:border-[var(--color-pib-accent)]',
                      isDeleting ? 'opacity-50 pointer-events-none' : '',
                    ].join(' ')}
                  >
                    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)_auto]">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]',
                              rule.enabled
                                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                                : 'border-amber-400/20 bg-amber-400/10 text-amber-300',
                            ].join(' ')}
                          >
                            <span className="material-symbols-outlined text-[13px]">{rule.enabled ? 'play_arrow' : 'pause'}</span>
                            {rule.enabled ? 'Active' : 'Paused'}
                          </span>
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
                            {delayLabel(rule.delayMinutes)}
                          </span>
                          <span className={score >= 80 ? 'rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300' : 'rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-300'}>
                            {score}% ready
                          </span>
                        </div>
                        <h2 className="truncate text-base font-semibold">{rule.name}</h2>
                        {rule.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--color-pib-text-muted)]">{rule.description}</p>
                        )}
                        <div className="mt-4 flex items-start gap-3 rounded-lg border border-[var(--color-pib-line)] bg-black/10 px-3 py-3">
                          <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-pib-accent)]">{triggerMeta.icon}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium">{triggerLabel(rule)}</p>
                            <p className="mt-1 line-clamp-2 text-[11px] text-[var(--color-pib-text-muted)]">{triggerMeta.sub}</p>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="eyebrow !text-[10px] mb-2">Action chain</p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {rule.actions.map((action, index) => (
                            <ActionChip key={`${action.type}-${index}`} action={action} />
                          ))}
                        </div>
                        <div className="space-y-2">
                          {rule.actions.slice(0, 3).map((action, index) => (
                            <div key={`${action.type}-detail-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                              <span className="h-5 w-5 shrink-0 rounded-full border border-[var(--color-pib-line)] text-center text-[10px] leading-5">
                                {index + 1}
                              </span>
                              <span className="truncate">{actionDetail(action)}</span>
                            </div>
                          ))}
                        </div>
                        {gaps.length > 0 && (
                          <p className="mt-3 text-[11px] text-amber-300">
                            Needs: {gaps.join(', ')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-end">
                        <button
                          type="button"
                          onClick={() => handleToggle(rule)}
                          disabled={isToggling}
                          title={rule.enabled ? 'Disable automation' : 'Enable automation'}
                          className={[
                            'cursor-pointer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none',
                            rule.enabled ? 'bg-[var(--color-pib-accent)]' : 'bg-[var(--color-pib-line-strong)]',
                            isToggling ? 'opacity-60' : '',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                              rule.enabled ? 'translate-x-6' : 'translate-x-1',
                            ].join(' ')}
                          />
                        </button>

                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/portal/settings/automations/${rule.id}/edit`}
                            title="Edit automation"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
                          >
                            <span className="material-symbols-outlined text-[17px]">edit</span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null)
                              setPendingDeleteRule(rule)
                            }}
                            disabled={isDeleting}
                            aria-label={`Delete automation ${rule.name}`}
                            title="Delete automation"
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
