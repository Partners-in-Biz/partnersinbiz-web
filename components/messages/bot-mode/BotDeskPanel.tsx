'use client'

import { useCallback, useEffect, useState } from 'react'
import { computersForBot, computerHasDesktopWatch } from '@/lib/messages/bot-computers'
import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'
import { Icon } from '@/components/studio'

export type RoutineRow = {
  id: string
  name: string
  schedule?: string
  enabled?: boolean
  source?: 'cron' | 'goal'
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
}: {
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
            source: row.source === 'cron' || row.source === 'goal' ? row.source : 'cron',
          })))
          return
        }
        // Fallback: legacy admin cron + standing goal
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

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.routinesLabel}</p>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{loading ? '…' : routines.length}</span>
          {onNewRoutine && (
            <button
              type="button"
              data-testid="bot-desk-new-routine"
              onClick={() => {
                onNewRoutine()
                // Refetch shortly after a /goal insert so the list can pick up standing goals.
                window.setTimeout(() => { loadRoutines() }, 2500)
              }}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
            >
              New
            </button>
          )}
        </div>
      </div>
      {routines.length === 0 ? (
        <p className="text-[11px] leading-5 text-[var(--color-pib-text-muted)]">
          Message {botName} or type /goal to save a skill, then schedule it as a routine. Recurring work keeps running on the computer after you close this tab.
        </p>
      ) : routines.map((routine) => (
        <article key={routine.id} data-testid={`bot-routine-${routine.id}`} className="mb-1.5 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-1.5">
          <p className="truncate text-[12px] font-medium text-[var(--color-pib-text)]">{routine.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--color-pib-text-muted)]">
            {routine.enabled === false ? 'Paused' : 'Scheduled'}
            {routine.schedule ? ` · ${routine.schedule}` : ''}
            {routine.source ? ` · ${routine.source}` : ''}
          </p>
        </article>
      ))}
    </section>
  )
}
