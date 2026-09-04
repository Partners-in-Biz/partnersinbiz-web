import type { BriefingWorkKind } from '@/lib/briefing/workKind'

export type SnoozeOption = { id: string; label: string; until: Date }

const HOUR_MS = 60 * 60 * 1000

/** `days` from `now` at 09:00 local time. */
function atNine(now: Date, days: number): Date {
  const next = new Date(now)
  next.setDate(next.getDate() + days)
  next.setHours(9, 0, 0, 0)
  return next
}

/** The next Monday strictly after today, at 09:00 local time. */
function nextMondayAtNine(now: Date): Date {
  const day = now.getDay() // 0 = Sunday, 1 = Monday
  const daysUntil = ((8 - day) % 7) || 7
  return atNine(now, daysUntil)
}

function inHours(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * HOUR_MS)
}

/**
 * Snooze presets per work lane. Every option is strictly in the future relative
 * to `now`; "09:00" options use local time.
 */
export function snoozeOptionsForKind(kind: BriefingWorkKind, now: Date, meetingStartIso?: string | null): SnoozeOption[] {
  const tomorrow: SnoozeOption = { id: 'tomorrow-09', label: 'Tomorrow 09:00', until: atNine(now, 1) }
  const inThreeDays: SnoozeOption = { id: 'in-3d-09', label: 'In 3 days 09:00', until: atNine(now, 3) }
  const nextMonday: SnoozeOption = { id: 'next-monday-09', label: 'Next Monday 09:00', until: nextMondayAtNine(now) }

  let options: SnoozeOption[]
  switch (kind) {
    case 'meeting': {
      options = []
      if (meetingStartIso) {
        const start = new Date(meetingStartIso)
        if (!Number.isNaN(start.getTime()) && start.getTime() - now.getTime() > HOUR_MS) {
          options.push({ id: 'hour-before', label: '1 hour before', until: new Date(start.getTime() - HOUR_MS) })
        }
      }
      options.push(tomorrow, inThreeDays)
      break
    }
    case 'reply':
      options = [{ id: 'in-3h', label: 'In 3 hours', until: inHours(now, 3) }, tomorrow, nextMonday]
      break
    case 'approval':
      options = [tomorrow, inThreeDays]
      break
    case 'agent':
      options = [{ id: 'in-4h', label: 'In 4 hours', until: inHours(now, 4) }, tomorrow]
      break
    case 'blocked':
    default:
      options = [tomorrow, nextMonday]
      break
  }
  return options.filter((option) => option.until.getTime() > now.getTime())
}
