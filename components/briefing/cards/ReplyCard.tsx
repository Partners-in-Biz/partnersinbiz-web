'use client'

import { Icon } from '@/components/studio'
import { briefingContactChannels, briefingUsefulSummary, humanText } from '@/lib/briefing/cardFacts'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import { gmailThreadUrl } from '../cockpit/googleDeepLinks'
import { CARD_PRIMARY_CLASS, CARD_SECONDARY_CLASS, CardFrame, Fact, Pill } from './CardFrame'
import { companyLine, metaString, personLine, stripViewLinks } from './format'
import type { BriefingCardActions } from './types'

const CHANNEL: Record<string, { icon: string; label: string }> = {
  'mailbox-message': { icon: 'mail', label: 'Email' },
  'social-inbox': { icon: 'forum', label: 'Social DM' },
  'support-ticket': { icon: 'support_agent', label: 'Support ticket' },
  comment: { icon: 'chat', label: 'Comment' },
  enquiry: { icon: 'contact_mail', label: 'Enquiry' },
  'form-submission': { icon: 'assignment', label: 'Form submission' },
  contact: { icon: 'person', label: 'Follow up' },
  deal: { icon: 'handshake', label: 'Deal follow-up' },
  activity: { icon: 'history', label: 'CRM follow-up' },
  notification: { icon: 'notifications', label: 'Notification' },
}

export function ReplyCard({ item, actions }: { item: BriefingCard; actions: BriefingCardActions }) {
  const type = item.source.type
  const channel = CHANNEL[type] ?? { icon: 'reply', label: 'Reply' }
  const channels = briefingContactChannels(item)
  const person = personLine(item)
  const company = companyLine(item)
  const subject = humanText(item.context.mailboxSubject) ?? humanText(item.context.supportTicketSubject) ?? metaString(item, 'subject')
  const snippet = stripViewLinks(humanText(item.excerpt, 200) ?? briefingUsefulSummary(item) ?? item.summary)
  const threadId = metaString(item, 'threadId') ?? (typeof item.metadata?.threadId === 'string' ? item.metadata.threadId : null)
  const isMailbox = type === 'mailbox-message'
  const href = actions.sourceHref(item)
  const stage = metaString(item, 'stageLabel', 'toStageLabel', 'contactStage', 'supportStatus', 'enquiryStatus')

  const primary = (
    <button
      type="button"
      className={CARD_PRIMARY_CLASS}
      disabled={actions.busy}
      onClick={(event) => {
        event.stopPropagation()
        actions.openMore(item)
      }}
    >
      <Icon name="reply" />
      Reply
    </button>
  )

  const secondary = isMailbox ? (
    <a
      href={gmailThreadUrl(threadId)}
      target="_blank"
      rel="noopener noreferrer"
      className={CARD_SECONDARY_CLASS}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="open_in_new" />
      Gmail
    </a>
  ) : channels.email ? (
    <a href={`mailto:${channels.email}`} className={CARD_SECONDARY_CLASS} onClick={(event) => event.stopPropagation()}>
      <Icon name="mail" />
      Email
    </a>
  ) : href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={CARD_SECONDARY_CLASS} onClick={(event) => event.stopPropagation()}>
      <Icon name="open_in_new" />
      Open
    </a>
  ) : (
    <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.done(item) }}>
      <Icon name="done" />
      Done
    </button>
  )

  return (
    <CardFrame
      item={item}
      kind="reply"
      eyebrowIcon={channel.icon}
      eyebrow={person ? `${channel.label} · ${person}` : channel.label}
      busy={actions.busy}
      onSelect={actions.select}
      onSnooze={actions.snooze}
      onMore={actions.openMore}
      actions={
        <>
          {primary}
          {secondary}
          <button
            type="button"
            className="pib-btn-secondary shrink-0 justify-center px-3 py-2 text-xs"
            title="Ask Pip to draft a reply"
            aria-label="Ask Pip to draft a reply"
            onClick={(event) => {
              event.stopPropagation()
              actions.askPip(item)
            }}
          >
            <Icon name="smart_toy" />
          </button>
        </>
      }
    >
      {snippet && snippet !== item.title ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{snippet}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {stage ? <Pill tone="info">{stage}</Pill> : null}
        <Fact label={isMailbox ? 'From' : type === 'support-ticket' ? 'Ticket' : 'Contact'} value={type === 'support-ticket' ? subject : person} />
        {isMailbox ? <Fact label="Subject" value={subject} /> : null}
        {type === 'support-ticket' ? <Fact label="Contact" value={person} /> : null}
        <Fact label="Company" value={company} />
        <Fact label="Deal" value={item.context.dealTitle} />
        <Fact label="Email" value={channels.email} href={channels.email ? `mailto:${channels.email}` : null} />
        <Fact label="Phone" value={channels.phone} href={channels.phone ? `tel:${channels.phone}` : null} />
      </div>
    </CardFrame>
  )
}
