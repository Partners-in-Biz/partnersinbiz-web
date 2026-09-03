'use client'

import { Icon } from '@/components/studio'
import type { ContextItemSummary } from '@/lib/chat-context/types'
import { displayStateStyle, displayStateLabel } from '@/lib/chat-context/displayStateStyles'

function agentStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'pending': return 'Queued'
    case 'picked-up': return 'Picked up'
    case 'in-progress': return 'Working'
    case 'awaiting-input': return 'Needs your input'
    case 'blocked': return 'Blocked'
    case 'failed': return 'Failed'
    case 'done': return 'Done'
    default: return status ? status.replaceAll('-', ' ') : 'No agent status'
  }
}

function isLive(status: string | undefined, state: ContextItemSummary['state']): boolean {
  if (state === 'running') return true
  return status === 'picked-up' || status === 'in-progress'
}

/**
 * Expandable agent activity panel for a project task in the Messages context canvas.
 * Shows live-ish status for in-progress work and the completed agent summary for done cards.
 */
export function ProjectTaskFeed({ item }: { item: ContextItemSummary }) {
  const style = displayStateStyle(item.state)
  const agent = item.agent
  const live = isLive(agent?.agentStatus, item.state)
  const agentName = agent?.agentId
    ? agent.agentId.charAt(0).toUpperCase() + agent.agentId.slice(1)
    : null

  return (
    <div
      data-testid={`project-task-feed-${item.id}`}
      className="space-y-2 border-t border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[10px] font-medium ${style.badgeClassName}`}>
          {live && <span className="h-1.5 w-1.5 animate-pulse rounded-[4px] bg-current" aria-hidden="true" />}
          {displayStateLabel(item.state)}
        </span>
        {agent?.agentStatus && (
          <span className="text-[10px] text-[var(--color-pib-text-muted)]">
            Agent: {agentStatusLabel(agent.agentStatus)}
            {agentName ? ` · ${agentName}` : ''}
          </span>
        )}
        {live && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--st-warning)]">
            <Icon name="sensors" className="text-[12px]" />
            Live feed
          </span>
        )}
      </div>

      {agent?.inputSpec && (
        <div>
          <p className="text-[9px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Assigned work</p>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--color-pib-text)]">{agent.inputSpec}</p>
        </div>
      )}

      {(agent?.summary || item.detail) && (
        <div>
          <p className="text-[9px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">
            {item.state === 'complete' ? 'What the agent did' : live ? 'Current activity' : 'Agent notes'}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--color-pib-text)]">
            {agent?.summary || item.detail}
          </p>
        </div>
      )}

      {!agent?.summary && !item.detail && !agent?.inputSpec && (
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          {live
            ? 'Agent is working - status updates appear here as the task progresses.'
            : item.state === 'complete'
              ? 'No agent summary was recorded for this completed task.'
              : 'No agent activity recorded yet for this card.'}
        </p>
      )}

      {agent?.artifacts && agent.artifacts.length > 0 && (
        <div>
          <p className="text-[9px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Artifacts</p>
          <ul className="mt-1 space-y-1">
            {agent.artifacts.map((artifact) => (
              <li key={`${artifact.type}:${artifact.ref}`}>
                <a
                  href={artifact.ref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-primary hover:underline"
                >
                  <Icon name={artifact.type === 'url' ? 'link' : 'draft'} className="text-[13px]" />
                  {artifact.label || artifact.ref}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.updatedAt && (
        <p className="text-[10px] text-[var(--color-pib-text-muted)]">
          Updated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.updatedAt))}
        </p>
      )}

      {item.href && (
        <a
          href={item.href}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-2.5 text-[11px] text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)]"
        >
          Open in project
          <Icon name="open_in_new" className="text-[14px]" />
        </a>
      )}
    </div>
  )
}
