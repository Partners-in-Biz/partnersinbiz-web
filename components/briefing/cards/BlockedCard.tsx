'use client'

import { Icon } from '@/components/studio'
import { briefingUsefulSummary, humanText } from '@/lib/briefing/cardFacts'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import { CARD_PRIMARY_CLASS, CARD_SECONDARY_CLASS, CardFrame, Fact, Pill } from './CardFrame'
import { actorAgentName, metaString, stripViewLinks } from './format'
import type { BriefingCardActions } from './types'

export function BlockedCard({ item, actions }: { item: BriefingCard; actions: BriefingCardActions }) {
  const owner = actorAgentName(item) ?? humanText(item.actor?.name) ?? null
  const reason = metaString(item, 'blockingReason', 'blockedReason', 'failureReason', 'error') ?? stripViewLinks(humanText(item.excerpt, 200) ?? briefingUsefulSummary(item) ?? item.summary)
  const needsPeet = item.metadata?.needsPeet === true || item.priority === 'critical' || item.priority === 'needs-peet'
  const href = actions.sourceHref(item)
  const canUnblock = actions.canUnblock(item)
  const canApprove = actions.canApprove(item)
  const status = metaString(item, 'agentStatus', 'runStatus', 'orderStatus', 'shipmentStatus', 'reportStatus', 'inventoryStatus', 'invoiceStatus', 'status')

  const primary = canUnblock ? (
    <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.unblock(item) }}>
      <Icon name="play_arrow" />
      Unblock
    </button>
  ) : canApprove ? (
    <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.approve(item) }}>
      <Icon name="verified" />
      Approve
    </button>
  ) : href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
      <Icon name="open_in_new" />
      Open
    </a>
  ) : (
    <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.openMore(item) }}>
      <Icon name="open_in_new" />
      Open
    </button>
  )

  const secondary = actions.canAssignAgent(item) ? (
    <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.assignAgent(item) }}>
      <Icon name="smart_toy" />
      Assign {actions.agentLabel(item)}
    </button>
  ) : (
    <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.createFollowUp(item) }}>
      <Icon name="add_task" />
      Follow-up
    </button>
  )

  return (
    <CardFrame
      item={item}
      kind="blocked"
      eyebrowIcon="front_hand"
      eyebrow={owner ? `Blocked · ${owner}` : 'Blocked'}
      busy={actions.busy}
      onSelect={actions.select}
      onSnooze={actions.snooze}
      onMore={actions.openMore}
      actions={
        <>
          {primary}
          {secondary}
        </>
      }
    >
      {reason && reason !== item.title ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
          <span className="text-[var(--color-pib-text)]">Why: </span>{reason}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {needsPeet ? <Pill tone="danger"><Icon name="person_alert" className="text-[12px]" />Needs you</Pill> : status ? <Pill tone="warn">{status.replace(/[_-]+/g, ' ')}</Pill> : null}
        <Fact label="Task" value={humanText(item.context.taskTitle)} />
        <Fact label="Project" value={humanText(item.context.projectName)} />
        <Fact label="Company" value={humanText(item.context.companyName)} />
        <Fact label="Order" value={humanText(item.context.orderTitle)} />
        <Fact label="Invoice" value={humanText(item.context.invoiceNumber)} />
      </div>
    </CardFrame>
  )
}
