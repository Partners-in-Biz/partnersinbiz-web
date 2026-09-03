'use client'

import { Icon } from '@/components/studio'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import { Pill, accentForKind } from './CardFrame'
import { metaString } from './format'
import type { BriefingCardActions } from './types'

export type AgentItemState = 'running' | 'waiting' | 'queued' | 'done' | 'failed' | 'other'

export type AgentItemsSummary = {
  total: number
  counts: Record<AgentItemState, number>
  /** e.g. "14 running · 2 waiting · 1 done" */
  label: string
}

const STATE_ORDER: AgentItemState[] = ['running', 'waiting', 'queued', 'done', 'failed', 'other']

/** Classify one agent-lane item from its status metadata, falling back to title heuristics. */
export function agentItemState(item: BriefingCard): AgentItemState {
  const status = (metaString(item, 'runStatus', 'agentStatus', 'seoTaskStatus', 'status', 'columnId') ?? '').toLowerCase().replace(/[_-]+/g, ' ')
  if (status) {
    if (/running|in progress|executing|working/.test(status)) return 'running'
    if (/paused|waiting|awaiting|approval|review/.test(status)) return 'waiting'
    if (/pending|queued|todo|assigned|scheduled/.test(status)) return 'queued'
    if (/done|completed|complete|finished|succeeded|success/.test(status)) return 'done'
    if (/failed|error|blocked|cancel+ed/.test(status)) return 'failed'
  }
  const copy = `${item.title} ${item.summary ?? ''}`.toLowerCase()
  if (/\b(is running|running|working on|in progress|started)\b/.test(copy)) return 'running'
  if (/\b(waiting|paused|awaiting|needs (your )?approval)\b/.test(copy)) return 'waiting'
  if (/\b(queued|pending|scheduled)\b/.test(copy)) return 'queued'
  if (/\b(done|completed|finished|delivered)\b/.test(copy)) return 'done'
  if (/\b(failed|error|blocked|cancelled|canceled)\b/.test(copy)) return 'failed'
  return 'other'
}

/** Pure summary of a group of agent items: counts per state plus a one-line label. */
export function summariseAgentItems(items: BriefingCard[]): AgentItemsSummary {
  const counts: Record<AgentItemState, number> = { running: 0, waiting: 0, queued: 0, done: 0, failed: 0, other: 0 }
  for (const item of items) counts[agentItemState(item)] += 1
  const parts = STATE_ORDER.filter((state) => counts[state] > 0 && state !== 'other').map((state) => `${counts[state]} ${state}`)
  if (counts.other > 0) parts.push(`${counts.other} ${parts.length ? 'other' : items.length === 1 ? 'item' : 'items'}`)
  return { total: items.length, counts, label: parts.length ? parts.join(' · ') : 'Nothing in flight' }
}

function stateTone(state: AgentItemState): 'ok' | 'warn' | 'info' | 'danger' | 'neutral' {
  switch (state) {
    case 'running':
      return 'ok'
    case 'waiting':
      return 'warn'
    case 'queued':
      return 'info'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

export type AgentGroupCardProps = {
  agentId: string
  agentName: string
  items: BriefingCard[]
  actions: BriefingCardActions
  expanded: boolean
  onToggle: () => void
}

/**
 * One compact card per agent that rolls up all of that agent's work. Collapsed
 * it only shows the summary line; expanded it lists each item with a title
 * button (`briefing-card-title`) and an Open link.
 */
export function AgentGroupCard({ agentId, agentName, items, actions, expanded, onToggle }: AgentGroupCardProps) {
  const summary = summariseAgentItems(items)
  const priority: BriefingCard['priority'] = items.some((item) => item.priority === 'critical') ? 'critical' : 'progress'
  const listId = `agent-group-${agentId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`

  return (
    <article
      data-testid="briefing-card"
      data-work-kind="agent"
      data-agent-id={agentId}
      className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3 transition hover:bg-[var(--color-pib-surface-muted)]"
      style={{ borderLeft: `3px solid ${accentForKind('agent', priority)}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="block min-w-0 flex-1 text-left"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          title={expanded ? 'Hide agent work' : 'Show agent work'}
        >
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
            <Icon name="smart_toy" className="text-[13px]" />
            <span className="truncate">{agentName}</span>
          </p>
          <p data-testid="agent-group-summary" className="mt-0.5 text-sm leading-5 text-[var(--color-pib-text)]">{summary.label}</p>
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <Icon name={expanded ? 'expand_less' : 'expand_more'} />
        </button>
      </div>

      {expanded ? (
        <ul id={listId} className="mt-2 grid gap-1 border-t border-[var(--color-pib-line)] pt-2">
          {items.map((item) => {
            const state = agentItemState(item)
            const href = actions.sourceHref(item)
            return (
              <li key={item.id} className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => actions.select(item)}>
                  <span data-testid="briefing-card-title" className="block truncate text-xs leading-5 text-[var(--color-pib-text)]">{item.title}</span>
                </button>
                <Pill tone={stateTone(state)} className="shrink-0 capitalize">{state}</Pill>
                {actions.canStopRun(item) ? (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-red-600 disabled:opacity-50"
                    onClick={(event) => {
                      event.stopPropagation()
                      actions.stopRun(item)
                    }}
                    disabled={actions.busy}
                    title="Stop this run"
                  >
                    Stop run
                  </button>
                ) : null}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[10px] text-[var(--color-pib-text-muted)] underline underline-offset-2 hover:text-[var(--color-pib-text)]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Open
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </article>
  )
}
