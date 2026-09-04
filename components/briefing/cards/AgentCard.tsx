'use client'

import { Icon } from '@/components/studio'
import { briefingUsefulSummary, humanText } from '@/lib/briefing/cardFacts'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import { CARD_PRIMARY_CLASS, CARD_SECONDARY_CLASS, CardFrame, Fact, Pill } from './CardFrame'
import { actorAgentName, metaString, stripViewLinks } from './format'
import type { BriefingCardActions } from './types'

function statusTone(status: string | null): { label: string; tone: 'ok' | 'warn' | 'info' | 'neutral' } {
  const value = (status ?? '').toLowerCase().replace(/[_-]+/g, ' ')
  if (/running|in progress|executing/.test(value)) return { label: 'Running', tone: 'ok' }
  if (/paused|waiting|awaiting/.test(value)) return { label: 'Waiting', tone: 'warn' }
  if (/pending|queued|todo|assigned/.test(value)) return { label: 'Queued', tone: 'info' }
  if (/done|completed|complete/.test(value)) return { label: 'Done', tone: 'neutral' }
  return { label: value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Working', tone: 'neutral' }
}

export function AgentCard({ item, actions }: { item: BriefingCard; actions: BriefingCardActions }) {
  const type = item.source.type
  const agent = actorAgentName(item) ?? actions.agentLabel(item)
  const status = statusTone(metaString(item, 'runStatus', 'agentStatus', 'seoTaskStatus', 'status', 'columnId'))
  const summary = stripViewLinks(briefingUsefulSummary(item) || item.summary)
  const href = actions.sourceHref(item)
  const canSendBack = actions.canApprove(item)
  const canStop = actions.canStopRun(item)
  const label = type === 'agent-run' ? 'Agent run' : type === 'project' ? 'Project' : type === 'seo-task' ? 'SEO sprint' : 'Agent task'

  return (
    <CardFrame
      item={item}
      kind="agent"
      eyebrowIcon="smart_toy"
      eyebrow={`${agent} · ${label}`}
      busy={actions.busy}
      onSelect={actions.select}
      onSnooze={actions.snooze}
      onSnoozeUntil={actions.snoozeUntil}
      onMore={actions.openMore}
      actions={
        <>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
              <Icon name="open_in_new" />
              {type === 'project' ? 'Open project' : 'Open task'}
            </a>
          ) : (
            <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.select(item) }}>
              <Icon name="open_in_new" />
              Open
            </button>
          )}
          {canSendBack ? (
            <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.sendBack(item) }}>
              <Icon name="undo" />
              Send back
            </button>
          ) : (
            <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.done(item) }}>
              <Icon name="done" />
              Done
            </button>
          )}
          {canStop ? (
            <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} title="Stop this run" onClick={(event) => { event.stopPropagation(); actions.stopRun(item) }}>
              <Icon name="stop_circle" />
              Stop run
            </button>
          ) : null}
        </>
      }
    >
      {summary && summary !== item.title ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{summary}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pill tone={status.tone}><Icon name={status.tone === 'ok' ? 'progress_activity' : 'schedule'} className="text-[12px]" />{status.label}</Pill>
        <Fact label="Task" value={humanText(item.context.taskTitle)} />
        <Fact label="Project" value={humanText(item.context.projectName)} />
        <Fact label="Company" value={humanText(item.context.companyName)} />
      </div>
    </CardFrame>
  )
}
