import type { BriefingCard, Mode } from '../cockpit/cockpitTypes'

export type BookCallInput = {
  startAt: string
  endAt: string
  title: string
}

/**
 * Callback bag the desk hands to every kind card. All side effects stay in
 * BriefingControlDesk so the cards remain presentational.
 */
export type BriefingCardActions = {
  mode: Mode
  busy: boolean
  select: (item: BriefingCard) => void
  openMore: (item: BriefingCard) => void
  snooze: (item: BriefingCard) => void
  done: (item: BriefingCard) => void
  sourceHref: (item: BriefingCard) => string | null
  askPip: (item: BriefingCard) => void
  // Approvals / blocked
  canApprove: (item: BriefingCard) => boolean
  approve: (item: BriefingCard) => void
  sendBack: (item: BriefingCard) => void
  canUnblock: (item: BriefingCard) => boolean
  unblock: (item: BriefingCard) => void
  canAssignAgent: (item: BriefingCard) => boolean
  assignAgent: (item: BriefingCard) => void
  agentLabel: (item: BriefingCard) => string
  createFollowUp: (item: BriefingCard) => void
  // Meetings
  canAddMeetLink: (item: BriefingCard) => boolean
  addMeetLink: (item: BriefingCard) => void
  canBookCall: (item: BriefingCard) => boolean
  bookCall: (item: BriefingCard, input: BookCallInput) => Promise<void>
}
