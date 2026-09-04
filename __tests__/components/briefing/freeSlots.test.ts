import {
  formatLocalDateTime,
  nextFreeSlotAfter,
  overlaps,
  parseLocalDateTime,
  slotTimeLabel,
  suggestFreeSlots,
} from '@/components/briefing/cards/freeSlots'
import type { BusyBlock } from '@/components/briefing/cards/types'

// A day far in the future so "after now" never interferes unless a test asks for it.
const DAY = '2030-03-12'
const EARLY = new Date(2029, 0, 1, 9, 0, 0, 0)

function block(start: string, end: string, title?: string): BusyBlock {
  return { start: `${DAY}T${start}:00`, end: `${DAY}T${end}:00`, title: title ?? null }
}

function times(slots: string[]): string[] {
  return slots.map(slotTimeLabel)
}

describe('suggestFreeSlots', () => {
  it('aligns slots to the step from the day start and returns local datetime-local strings', () => {
    const slots = suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: EARLY })
    expect(slots).toEqual([`${DAY}T08:00`, `${DAY}T08:30`, `${DAY}T09:00`])
    for (const slot of slots) expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('honours a custom step and day start', () => {
    const slots = suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 15, now: EARLY, stepMinutes: 15, dayStartHour: 9, limit: 4 })
    expect(times(slots)).toEqual(['09:00', '09:15', '09:30', '09:45'])
  })

  it('only proposes slots whose full duration fits before the day end', () => {
    const slots = suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 60, now: EARLY, dayStartHour: 15, dayEndHour: 17, limit: 10 })
    expect(times(slots)).toEqual(['15:00', '15:30', '16:00'])
    expect(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 90, now: EARLY, dayStartHour: 16, dayEndHour: 17 })).toEqual([])
  })

  it('skips slots that overlap busy blocks, including partial overlaps', () => {
    const busy = [block('08:15', '09:00', 'Standup'), block('10:00', '10:30', 'Buhle')]
    const slots = suggestFreeSlots({ dateYmd: DAY, busy, durationMinutes: 30, now: EARLY, limit: 10 })
    // 08:00 clashes with 08:15–09:00, 08:30 too; 10:00 clashes with Buhle.
    expect(times(slots)).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'])
    expect(times(slots)).not.toContain('08:00')
    expect(times(slots)).not.toContain('10:00')
  })

  it('treats busy blocks with an explicit offset like the card does (absolute instants)', () => {
    // Build the block from local wall-clock so the test holds in any TZ.
    const start = new Date(2030, 2, 12, 8, 0, 0, 0).toISOString()
    const end = new Date(2030, 2, 12, 9, 0, 0, 0).toISOString()
    const slots = suggestFreeSlots({ dateYmd: DAY, busy: [{ start, end }], durationMinutes: 30, now: EARLY })
    expect(times(slots)).toEqual(['09:00', '09:30', '10:00'])
  })

  it('only proposes slots strictly after now when the day is today', () => {
    const now = new Date(2030, 2, 12, 10, 0, 0, 0)
    const slots = suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now })
    // 10:00 is not strictly after 10:00.
    expect(times(slots)).toEqual(['10:30', '11:00', '11:30'])
    const later = suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: new Date(2030, 2, 12, 10, 5, 0, 0) })
    expect(times(later)).toEqual(['10:30', '11:00', '11:30'])
  })

  it('returns nothing for a day already in the past and everything for a future day', () => {
    expect(suggestFreeSlots({ dateYmd: '2020-01-01', busy: [], durationMinutes: 30, now: EARLY })).toEqual([])
    expect(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: EARLY })).toHaveLength(3)
  })

  it('respects the limit', () => {
    expect(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: EARLY, limit: 1 })).toEqual([`${DAY}T08:00`])
    expect(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: EARLY, limit: 5 })).toHaveLength(5)
    expect(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: EARLY, limit: 0 })).toEqual([])
  })

  it('proposes the whole working day when there are no busy blocks', () => {
    const slots = suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 30, now: EARLY, limit: 100 })
    expect(slots).toHaveLength(18) // 08:00 … 16:30 at 30-minute steps
    expect(slots[0]).toBe(`${DAY}T08:00`)
    expect(slots[slots.length - 1]).toBe(`${DAY}T16:30`)
  })

  it('ignores busy blocks whose start or end do not parse', () => {
    const busy: BusyBlock[] = [
      { start: 'not-a-date', end: `${DAY}T12:00:00` },
      { start: `${DAY}T08:00:00`, end: '' },
      block('09:00', '09:30', 'Real'),
    ]
    const slots = suggestFreeSlots({ dateYmd: DAY, busy, durationMinutes: 30, now: EARLY, limit: 4 })
    expect(times(slots)).toEqual(['08:00', '08:30', '09:30', '10:00'])
  })

  it('returns nothing for a malformed or impossible day', () => {
    expect(suggestFreeSlots({ dateYmd: '', busy: [], durationMinutes: 30, now: EARLY })).toEqual([])
    expect(suggestFreeSlots({ dateYmd: '2030-3-12', busy: [], durationMinutes: 30, now: EARLY })).toEqual([])
    expect(suggestFreeSlots({ dateYmd: '2030-02-31', busy: [], durationMinutes: 30, now: EARLY })).toEqual([])
  })

  it('anchors suggestions at or after "from" when it falls on the same day', () => {
    const busy = [block('10:00', '10:30', 'Buhle')]
    expect(times(suggestFreeSlots({ dateYmd: DAY, busy, durationMinutes: 30, now: EARLY, from: `${DAY}T10:15` }))).toEqual(['10:30', '11:00', '11:30'])
    expect(times(suggestFreeSlots({ dateYmd: DAY, busy, durationMinutes: 30, now: EARLY, from: `${DAY}T11:00` }))).toEqual(['11:00', '11:30', '12:00'])
    // An anchor on another day is ignored.
    expect(times(suggestFreeSlots({ dateYmd: DAY, busy, durationMinutes: 30, now: EARLY, from: '2030-03-13T16:00' }))).toEqual(['08:00', '08:30', '09:00'])
    // Past the end of the working day there is nothing left.
    expect(suggestFreeSlots({ dateYmd: DAY, busy, durationMinutes: 30, now: EARLY, from: `${DAY}T16:45` })).toEqual([])
  })

  it('falls back to sane defaults for a non-positive duration or step', () => {
    expect(times(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: 0, now: EARLY }))).toEqual(['08:00', '08:30', '09:00'])
    expect(times(suggestFreeSlots({ dateYmd: DAY, busy: [], durationMinutes: Number.NaN, now: EARLY, stepMinutes: -5 }))).toEqual(['08:00', '08:30', '09:00'])
  })
})

describe('nextFreeSlotAfter', () => {
  const busy = [block('10:00', '10:30', 'Buhle'), block('11:00', '12:00', 'Team sync')]

  it('finds the first aligned free slot at or after the chosen time', () => {
    expect(nextFreeSlotAfter(`${DAY}T10:15`, busy, 30, { now: EARLY })).toBe(`${DAY}T10:30`)
    expect(nextFreeSlotAfter(`${DAY}T10:00`, busy, 30, { now: EARLY })).toBe(`${DAY}T10:30`)
    // 10:30 with 45 min would run into Team sync; 12:00 is the next fit.
    expect(nextFreeSlotAfter(`${DAY}T10:15`, busy, 45, { now: EARLY })).toBe(`${DAY}T12:00`)
    expect(nextFreeSlotAfter(`${DAY}T11:20`, busy, 30, { now: EARLY })).toBe(`${DAY}T12:00`)
  })

  it('returns the chosen time itself when it is already free and aligned', () => {
    expect(nextFreeSlotAfter(`${DAY}T14:00`, busy, 30, { now: EARLY })).toBe(`${DAY}T14:00`)
  })

  it('returns null when nothing free remains that day or the input is malformed', () => {
    expect(nextFreeSlotAfter(`${DAY}T16:45`, busy, 30, { now: EARLY })).toBeNull()
    expect(nextFreeSlotAfter(`${DAY}T10:15`, busy, 30, { now: new Date(2030, 2, 12, 17, 0, 0, 0) })).toBeNull()
    expect(nextFreeSlotAfter('garbage', busy, 30, { now: EARLY })).toBeNull()
    expect(nextFreeSlotAfter('', busy, 30, { now: EARLY })).toBeNull()
  })
})

describe('overlaps', () => {
  const blk = block('10:00', '10:30')
  const at = (h: number, m: number) => new Date(2030, 2, 12, h, m, 0, 0)

  it('detects intersecting ranges and treats touching edges as free', () => {
    expect(overlaps(blk, at(10, 15), at(10, 45))).toBe(true)
    expect(overlaps(blk, at(9, 45), at(10, 15))).toBe(true)
    expect(overlaps(blk, at(9, 0), at(12, 0))).toBe(true)
    expect(overlaps(blk, at(10, 30), at(11, 0))).toBe(false)
    expect(overlaps(blk, at(9, 30), at(10, 0))).toBe(false)
  })

  it('never overlaps when the block does not parse', () => {
    expect(overlaps({ start: 'nope', end: `${DAY}T10:30:00` }, at(10, 0), at(11, 0))).toBe(false)
    expect(overlaps({ start: `${DAY}T10:00:00`, end: 'nope' }, at(10, 0), at(11, 0))).toBe(false)
  })
})

describe('local datetime helpers', () => {
  it('round-trips datetime-local strings', () => {
    const parsed = parseLocalDateTime(`${DAY}T10:05`)
    expect(parsed).toEqual(new Date(2030, 2, 12, 10, 5, 0, 0))
    expect(formatLocalDateTime(parsed as Date)).toBe(`${DAY}T10:05`)
    expect(formatLocalDateTime(new Date(2030, 0, 3, 7, 4, 59, 0))).toBe('2030-01-03T07:04')
    expect(parseLocalDateTime('2030-03-12')).toBeNull()
    expect(parseLocalDateTime(null)).toBeNull()
  })

  it('labels a slot with its HH:mm', () => {
    expect(slotTimeLabel(`${DAY}T10:30`)).toBe('10:30')
    expect(slotTimeLabel('weird')).toBe('weird')
  })
})
