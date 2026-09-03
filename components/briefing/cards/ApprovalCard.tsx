'use client'

import { Icon } from '@/components/studio'
import { briefingUsefulSummary, formatBriefingMoney, humanText } from '@/lib/briefing/cardFacts'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import { CARD_PRIMARY_CLASS, CARD_SECONDARY_CLASS, CardFrame, Fact, Pill } from './CardFrame'
import { actorAgentName, metaString, stripViewLinks } from './format'
import type { BriefingCardActions } from './types'

const WHAT: Record<string, string> = {
  approval: 'Approval gate',
  'client-document': 'Document',
  'social-post': 'Social post',
  'seo-content': 'SEO content',
  'ad-campaign': 'Ad campaign',
  expense: 'Expense',
  quote: 'Quote',
  invoice: 'Invoice',
  broadcast: 'Broadcast',
  campaign: 'Campaign',
  report: 'Report',
  'agent-output': 'Agent work',
  'agent-learning-review': 'Agent learning',
  'business-insight-review': 'Business insight',
  'workspace-broker-job': 'Workspace job',
  'agent-run': 'Agent run',
  task: 'Task',
}

export function ApprovalCard({ item, actions }: { item: BriefingCard; actions: BriefingCardActions }) {
  const type = item.source.type
  const what = WHAT[type] ?? 'Review'
  const producer = actorAgentName(item) ?? humanText(item.actor?.name) ?? null
  const preview = stripViewLinks(humanText(item.excerpt, 220) ?? briefingUsefulSummary(item) ?? item.summary)
  const amount = formatBriefingMoney(item.metadata?.value ?? item.metadata?.amount ?? item.metadata?.total ?? item.metadata?.dailyBudget, item.metadata?.currency)
  const stage = metaString(item, 'actionStage', 'reviewState', 'approvalStatus', 'documentStatus', 'invoiceStatus', 'quoteStatus', 'campaignStatus', 'broadcastStatus', 'runStatus')
  const platforms = Array.isArray(item.metadata?.platforms) ? (item.metadata?.platforms as unknown[]).filter((value): value is string => typeof value === 'string') : []
  const href = actions.sourceHref(item)
  const canApprove = actions.canApprove(item)

  return (
    <CardFrame
      item={item}
      kind="approval"
      eyebrowIcon="verified"
      eyebrow={producer ? `${what} · from ${producer}` : what}
      busy={actions.busy}
      onSelect={actions.select}
      onSnooze={actions.snooze}
      onMore={actions.openMore}
      actions={
        <>
          {canApprove ? (
            <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.approve(item) }}>
              <Icon name="verified" />
              Approve
            </button>
          ) : href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
              <Icon name="open_in_new" />
              Review
            </a>
          ) : (
            <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.openMore(item) }}>
              <Icon name="rate_review" />
              Review
            </button>
          )}
          <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.openMore(item) }}>
            <Icon name="edit_note" />
            Request changes
          </button>
        </>
      }
    >
      {preview && preview !== item.title ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{preview}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {stage ? <Pill tone="warn">{stage.replace(/[_-]+/g, ' ')}</Pill> : null}
        {platforms.map((platform) => <Pill key={platform}>{platform}</Pill>)}
        <Fact label="Invoice" value={item.context.invoiceNumber} />
        <Fact label="Quote" value={item.context.quoteNumber} />
        <Fact label="Value" value={amount} />
        <Fact label="Contact" value={humanText(item.context.contactName)} />
        <Fact label="Document" value={item.context.documentTitle} />
        <Fact label="Campaign" value={item.context.campaignName ?? item.context.adCampaignName ?? item.context.broadcastName} />
        <Fact label="Project" value={item.context.projectName} />
        <Fact label="Task" value={item.context.taskTitle} />
        <Fact label="Company" value={item.context.companyName} />
      </div>
    </CardFrame>
  )
}
