'use client'

import { useEffect, useState } from 'react'
import { computersForBot } from '@/lib/messages/bot-computers'
import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'

type RoutineRow = {
  id: string
  name: string
  schedule?: string
  enabled?: boolean
}

export function BotDeskPanel({
  botId,
  botName,
  computers,
  workbenchOpen,
  isolatedFolder,
  standingGoal,
  onOpenScreen,
  onNewRoutine,
}: {
  botId?: string | null
  botName: string
  computers: VisibleBotComputer[]
  workbenchOpen?: boolean
  isolatedFolder?: string | null
  standingGoal?: string | null
  onOpenScreen?: () => void
  onNewRoutine?: () => void
}) {
  const botComputers = botId ? computersForBot(computers, botId) : computers
  const online = botComputers.filter((computer) => computer.online)
  const screenLabel = online[0]?.label ?? botComputers[0]?.label ?? 'No computer paired'

  return (
    <aside
      data-testid="bot-desk-panel"
      aria-label={`${botName}'s desk`}
      className="hidden min-h-0 w-[280px] shrink-0 flex-col overflow-hidden border-l border-white/[0.08] bg-black/40 xl:flex"
    >
      <section className="shrink-0 border-b border-white/[0.08] p-3">
        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">
          {botName}'s {BOT_MODE_COPY.screenLabel.toLowerCase()}
        </p>
        <button
          type="button"
          data-testid="bot-desk-open-screen"
          onClick={onOpenScreen}
          className="mt-2 flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] text-center hover:border-primary/30 hover:bg-primary/[0.06]"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-primary">screenshot_monitor</span>
          <span className="px-3 text-[11px] text-[var(--color-pib-text)]">{screenLabel}</span>
          <span className="text-[10px] text-[var(--color-pib-text-muted)]">
            {workbenchOpen ? 'Computer is open' : online.length > 0 ? 'Click to watch the computer' : 'Pair a Mac or VPS'}
          </span>
          {isolatedFolder ? (
            <span className="truncate px-3 text-[10px] text-[var(--color-pib-text-muted)]">{isolatedFolder}</span>
          ) : null}
        </button>
      </section>
      <BotRoutinesList botId={botId} botName={botName} standingGoal={standingGoal} onNewRoutine={onNewRoutine} />
    </aside>
  )
}

function BotRoutinesList({
  botId,
  botName,
  standingGoal,
  onNewRoutine,
}: {
  botId?: string | null
  botName: string
  standingGoal?: string | null
  onNewRoutine?: () => void
}) {
  const [routines, setRoutines] = useState<RoutineRow[]>(() => (
    standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true }] : []
  ))

  useEffect(() => {
    if (!botId) {
      setRoutines(standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true }] : [])
      return
    }
    let cancelled = false
    fetch(`/api/v1/admin/agents/${encodeURIComponent(botId)}/cron`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return
        const jobs = (body?.data ?? body)?.jobs
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
              }]
            })
          : []
        if (fromCron.length > 0) {
          setRoutines(fromCron)
          return
        }
        setRoutines(standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true }] : [])
      })
      .catch(() => {
        if (!cancelled) {
          setRoutines(standingGoal ? [{ id: 'standing-goal', name: standingGoal, schedule: 'Standing goal', enabled: true }] : [])
        }
      })
    return () => { cancelled = true }
  }, [botId, standingGoal])

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.routinesLabel}</p>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{routines.length}</span>
          {onNewRoutine && (
            <button
              type="button"
              data-testid="bot-desk-new-routine"
              onClick={onNewRoutine}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
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
        <article key={routine.id} data-testid={`bot-routine-${routine.id}`} className="mb-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
          <p className="truncate text-[12px] font-medium text-[var(--color-pib-text)]">{routine.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--color-pib-text-muted)]">
            {routine.enabled === false ? 'Paused' : 'Scheduled'}
            {routine.schedule ? ` · ${routine.schedule}` : ''}
          </p>
        </article>
      ))}
    </section>
  )
}
