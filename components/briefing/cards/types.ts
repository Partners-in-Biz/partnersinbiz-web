import type { BriefingCard, Mode } from '../cockpit/cockpitTypes'

export type BookCallInput = {
  startAt: string
  endAt: string
  title: string
}

/** A busy slot on the calendar for a given day (ISO datetimes). */
export type BusyBlock = { start: string; end: string; title?: string | null }

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
  /** Snooze until a specific ISO datetime (the desk POSTs snoozedUntil). */
  snoozeUntil: (item: BriefingCard, untilIso: string) => void
  /** Admin-only: stop a live Hermes run. */
  canStopRun: (item: BriefingCard) => boolean
  stopRun: (item: BriefingCard) => void
  /** Busy blocks for a calendar day (YYYY-MM-DD) so the Book call picker can flag conflicts. */
  loadBusy: (dateYmd: string) => Promise<BusyBlock[]>
}
