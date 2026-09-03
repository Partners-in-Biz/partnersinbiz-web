'use client'

import type { BriefingCard } from '../cockpit/cockpitTypes'
import { resolveWorkKind, type BriefingWorkKind } from '@/lib/briefing/workKind'
import { AgentCard } from './AgentCard'
import { ApprovalCard } from './ApprovalCard'
import { BlockedCard } from './BlockedCard'
import { MeetingCard } from './MeetingCard'
import { ReplyCard } from './ReplyCard'
import type { BriefingCardActions } from './types'

export function BriefingCardForKind({ item, actions, kind }: { item: BriefingCard; actions: BriefingCardActions; kind?: BriefingWorkKind }) {
  const resolved = kind ?? resolveWorkKind(item)
  switch (resolved) {
    case 'meeting':
      return <MeetingCard item={item} actions={actions} />
    case 'approval':
      return <ApprovalCard item={item} actions={actions} />
    case 'agent':
      return <AgentCard item={item} actions={actions} />
    case 'blocked':
      return <BlockedCard item={item} actions={actions} />
    case 'reply':
    default:
      return <ReplyCard item={item} actions={actions} />
  }
}

export { AgentCard, ApprovalCard, BlockedCard, MeetingCard, ReplyCard }
export { AgentGroupCard, summariseAgentItems, type AgentGroupCardProps } from './AgentGroupCard'
export { snoozeOptionsForKind, type SnoozeOption } from './snooze'
export type { BriefingCardActions, BookCallInput, BusyBlock } from './types'
