'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { computersForBot, computerHasDesktopWatch } from '@/lib/messages/bot-computers'
import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'
import { Icon } from '@/components/studio'

export type RoutineRow = {
  id: string
  name: string
  schedule?: string
  enabled?: boolean
  source?: 'cron' | 'goal' | 'routine'
  prompt?: string
  triggerKind?: 'schedule' | 'event'
}

export type RoutineRunRow = {
  runId: string
  status: string
  startedAtMs: number
  finishedAtMs?: number | null
  eventSummary?: string | null
}

export type BotDeskPanelVariant = 'rail' | 'sheet' | 'drawer'

export function BotDeskPanel({
  botId,
  botName,
  computers,
  workbenchOpen,
  isolatedFolder,
  standingGoal,
  orgId,
  latestFrameUrl,
  sessionStatus,
  following,
  computersHref,
  onOpenScreen,
  onNewRoutine,
  variant = 'rail',
  profile,
}: {
  /** Bot profile (avatar, pin, email) rendered above the screen section. */
  profile?: ReactNode
  botId?: string | null
  botName: string
  computers: VisibleBotComputer[]
  workbenchOpen?: boolean
  isolatedFolder?: string | null
  standingGoal?: string | null
  orgId?: string | null
  latestFrameUrl?: string | null
  sessionStatus?: string | null
  following?: boolean
  computersHref?: string | null
  onOpenScreen?: () => void
  onNewRoutine?: () => void
  variant?: BotDeskPanelVariant
}) {
  const botComputers = botId ? computersForBot(computers, botId) : computers
  const online = botComputers.filter((computer) => computer.online)
  const primary = online[0] ?? botComputers[0] ?? null
  const screenLabel = primary?.label ?? 'No computer paired'
  const hasDesktop = primary ? computerHasDesktopWatch(primary) : false
  const needsScreenRecording = primary?.platform === 'macos' && !hasDesktop
  const deviceBadge = primary?.platform === 'macos'
    ? 'Mac'
    : primary?.kind === 'vps'
      ? 'VPS'
      : primary
        ? 'Computer'
        : null

  const watching = Boolean(following && latestFrameUrl)
  const statusPill = !primary
    ? 'Offline'
    : !primary.online
      ? 'Offline'
      : watching
        ? 'Watching'
        : sessionStatus === 'running'
          ? 'Idle'
          : sessionStatus === 'awaiting_approval'
            ? 'Approve'
            : workbenchOpen
              ? 'Open'
              : 'Idle'

  const actionCopy = !primary || !primary.online
    ? 'Wake or pair a computer'
    : needsScreenRecording
      ? 'Grant Screen Recording on this Mac'
      : hasDesktop
        ? `Watch ${botName}'s screen`
        : `Watch ${botName}'s browser`

  const shellClass = variant === 'rail'
    ? 'hidden min-h-0 w-[280px] shrink-0 flex-col overflow-hidden border-l border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_40%,transparent)] xl:flex'
    : variant === 'drawer'
      ? 'flex min-h-0 w-full max-w-[320px] flex-col overflow-hidden border-l border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_40%,transparent)]'
      : 'flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]'

  return (
    <aside
      data-testid="bot-desk-panel"
      data-variant={variant}
      aria-label={`${botName}'s desk`}
      className={shellClass}
    >
      {profile ? <div className="shrink-0">{profile}</div> : null}
      <section className="shrink-0 border-b border-[var(--color-pib-line)] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">
            {botName}&apos;s {BOT_MODE_COPY.screenLabel.toLowerCase()}
          </p>
          <span
            data-testid="bot-desk-status-pill"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusPill === 'Watching' ? 'bg-emerald-400' : statusPill === 'Offline' ? 'bg-red-400' : 'bg-amber-300'}`} />
            {statusPill}
          </span>
        </div>
        <button
          type="button"
          data-testid="bot-desk-open-screen"
          onClick={onOpenScreen}
          disabled={!onOpenScreen}
          className="relative mt-2 flex h-36 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] text-center hover:border-primary/30 hover:bg-primary/[0.06] disabled:opacity-50"
        >
          {latestFrameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={latestFrameUrl}
              alt={`${botName} screen`}
              data-testid="bot-desk-frame-thumb"
              className="absolute inset-0 h-full w-full object-cover opacity-80"
            />
          ) : (
            <Icon name="screenshot_monitor" className="text-[28px] text-primary" />
          )}
          <span className="relative z-[1] px-3 text-[11px] text-[var(--color-pib-text)] drop-shadow">{screenLabel}</span>
          <span className="relative z-[1] text-[10px] text-[var(--color-pib-text-muted)] drop-shadow">
            {primary?.online ? actionCopy : computersHref ? actionCopy : 'Pair a Mac or VPS'}
          </span>
          <div className="relative z-[1] flex items-center gap-1">
            {deviceBadge ? (
              <span data-testid="bot-desk-device-badge" className="rounded bg-black/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">
                {deviceBadge}
              </span>
            ) : null}
            {hasDesktop ? (
              <span className="rounded bg-primary/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-on-primary">
                Desktop
              </span>
            ) : null}
          </div>
          {isolatedFolder ? (
            <span className="relative z-[1] truncate px-3 text-[10px] text-[var(--color-pib-text-muted)]">{isolatedFolder}</span>
          ) : null}
        </button>
        {!primary?.online && computersHref ? (
          <a
            href={computersHref}
            data-testid="bot-desk-pair-link"
            className="mt-2 block text-center text-[10px] font-medium text-primary hover:underline"
          >
            Open linked computers
          </a>
        ) : null}
      </section>
      <BotRoutinesList
        botId={botId}
        botName={botName}
        orgId={orgId}
        standingGoal={standingGoal}
        onNewRoutine={onNewRoutine}
      />
    </aside>
  )
}

function BotRoutinesList({
  botId,
  botName,
  orgId,
  standingGoal,
  onNewRoutine,
}: {
  botId?: string | null
  botName: string
  orgId?: string | null
  standingGoal?: string | null
  onNewRoutine?: () => void
}) {
  const [routines, setRoutines] = useState<RoutineRow[]>(() => (
    standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true, source: 'goal' }] : []
  ))
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formCron, setFormCron] = useState('0 9 * * *')
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runsByRoutine, setRunsByRoutine] = useState<Record<string, RoutineRunRow[]>>({})

  const loadRoutines = useCallback(() => {
    if (!botId) {
      setRoutines(standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true, source: 'goal' }] : [])
      return
    }
    let cancelled = false
    setLoading(true)
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
    fetch(`/api/v1/bots/${encodeURIComponent(botId)}/routines${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return
        const rows = (body?.data ?? body)?.routines
        if (Array.isArray(rows) && rows.length > 0) {
          setRoutines(rows.map((row: Record<string, unknown>, index: number) => ({
            id: typeof row.id === 'string' ? row.id : `routine-${index}`,
            name: typeof row.name === 'string' ? row.name : 'Routine',
            schedule: typeof row.schedule === 'string' ? row.schedule : undefined,
            enabled: row.enabled !== false,
            source: row.source === 'cron' || row.source === 'goal' || row.source === 'routine'
              ? row.source
              : 'cron',
            prompt: typeof row.prompt === 'string' ? row.prompt : undefined,
            triggerKind: row.triggerKind === 'event' || row.triggerKind === 'schedule' ? row.triggerKind : undefined,
          })))
          return
        }
        return fetch(`/api/v1/admin/agents/${encodeURIComponent(botId)}/cron`)
          .then((res) => (res.ok ? res.json() : null))
          .then((cronBody) => {
            if (cancelled) return
            const jobs = (cronBody?.data ?? cronBody)?.jobs
            const fromCron: RoutineRow[] = Array.isArray(jobs)
              ? jobs.flatMap((job: Record<string, unknown>, index: number) => {
                  const name = typeof job.name === 'string'
                    ? job.name
                    : typeof job.title === 'string'
                      ? job.title
                      : typeof job.prompt === 'string'
                        ? job.prompt
                        : null
                  if (!name) return []
                  return [{
                    id: typeof job.id === 'string' ? job.id : `routine-${index}`,
                    name,
                    schedule: typeof job.schedule === 'string' ? job.schedule : typeof job.cron === 'string' ? job.cron : undefined,
                    enabled: job.enabled !== false && job.paused !== true,
                    source: 'cron' as const,
                  }]
                })
              : []
            if (fromCron.length > 0) {
              setRoutines(fromCron)
              return
            }
            setRoutines(standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true, source: 'goal' }] : [])
          })
      })
      .catch(() => {
        if (!cancelled) {
          setRoutines(standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true, source: 'goal' }] : [])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [botId, orgId, standingGoal])

  useEffect(() => {
    const cleanup = loadRoutines()
    return typeof cleanup === 'function' ? cleanup : undefined
  }, [loadRoutines])

  const loadRuns = useCallback(async (routineId: string) => {
    if (!botId || !routineId.startsWith('rt_')) return
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
    try {
      const res = await fetch(`/api/v1/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}/runs${qs}`)
      if (!res.ok) return
      const body = await res.json()
      const runs = (body?.data ?? body)?.runs
      if (!Array.isArray(runs)) return
      setRunsByRoutine((prev) => ({
        ...prev,
        [routineId]: runs.map((row: Record<string, unknown>) => ({
          runId: typeof row.runId === 'string' ? row.runId : String(row.runId ?? ''),
          status: typeof row.status === 'string' ? row.status : 'unknown',
          startedAtMs: typeof row.startedAtMs === 'number' ? row.startedAtMs : 0,
          finishedAtMs: typeof row.finishedAtMs === 'number' ? row.finishedAtMs : null,
          eventSummary: typeof row.eventSummary === 'string' ? row.eventSummary : null,
        })),
      }))
    } catch {
      // ignore
    }
  }, [botId, orgId])

  const createRoutine = async () => {
    if (!botId || !orgId) {
      setFormError('Bot and organisation are required')
      return
    }
    if (!formName.trim() || !formPrompt.trim()) {
      setFormError('Name and prompt are required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/v1/bots/${encodeURIComponent(botId)}/routines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name: formName.trim(),
          prompt: formPrompt.trim(),
          accessScope: 'personal',
          trigger: { kind: 'schedule', cron: formCron.trim() || '0 9 * * *', tz: 'UTC' },
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : `Create failed (${res.status})`)
      }
      setShowForm(false)
      setFormName('')
      setFormCron('0 9 * * *')
      setFormPrompt('')
      loadRoutines()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.routinesLabel}</p>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{loading ? '…' : routines.length}</span>
          <button
            type="button"
            data-testid="bot-desk-new-routine"
            onClick={() => {
              setShowForm((open) => !open)
              onNewRoutine?.()
            }}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
          >
            New routine
          </button>
        </div>
      </div>

      {showForm ? (
        <div data-testid="bot-desk-routine-form" className="mb-3 space-y-1.5 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-2">
          <input
            data-testid="bot-desk-routine-name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Name"
            className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-[11px] text-[var(--color-pib-text)]"
          />
          <input
            data-testid="bot-desk-routine-cron"
            value={formCron}
            onChange={(e) => setFormCron(e.target.value)}
            placeholder="Cron (0 9 * * *)"
            className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--color-pib-text)]"
          />
          <textarea
            data-testid="bot-desk-routine-prompt"
            value={formPrompt}
            onChange={(e) => setFormPrompt(e.target.value)}
            placeholder="Prompt"
            rows={3}
            className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-[11px] text-[var(--color-pib-text)]"
          />
          {formError ? <p className="text-[10px] text-red-400">{formError}</p> : null}
          <button
            type="button"
            data-testid="bot-desk-routine-save"
            disabled={saving}
            onClick={() => void createRoutine()}
            className="w-full rounded bg-primary/90 px-2 py-1 text-[11px] font-medium text-on-primary disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      ) : null}

      {routines.length === 0 ? (
        <p className="text-[11px] leading-5 text-[var(--color-pib-text-muted)]">
          Message {botName}, type /routine, or use New routine to schedule recurring work on this computer.
        </p>
      ) : routines.map((routine) => (
        <article key={routine.id} data-testid={`bot-routine-${routine.id}`} className="mb-1.5 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-1.5">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => {
              if (routine.source !== 'routine') return
              const next = expandedId === routine.id ? null : routine.id
              setExpandedId(next)
              if (next) void loadRuns(next)
            }}
          >
            <p className="truncate text-[12px] font-medium text-[var(--color-pib-text)]">{routine.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-[var(--color-pib-text-muted)]">
              {routine.enabled === false ? 'Paused' : 'Scheduled'}
              {routine.schedule ? ` · ${routine.schedule}` : ''}
              {routine.source ? ` · ${routine.source}` : ''}
            </p>
          </button>
          {expandedId === routine.id && routine.source === 'routine' ? (
            <ul className="mt-1.5 space-y-1 border-t border-[var(--color-pib-line)] pt-1.5">
              {(runsByRoutine[routine.id] ?? []).length === 0 ? (
                <li className="text-[10px] text-[var(--color-pib-text-muted)]">No runs yet</li>
              ) : (runsByRoutine[routine.id] ?? []).map((run) => (
                <li key={run.runId} className="text-[10px] text-[var(--color-pib-text-muted)]">
                  {run.status}
                  {run.startedAtMs ? ` · ${new Date(run.startedAtMs).toLocaleString()}` : ''}
                  {run.eventSummary ? ` · ${run.eventSummary}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </section>
  )
}
