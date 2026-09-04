import type { BusyBlock } from './types'

/**
 * Pure helpers behind the Book call popover's "Free: 10:30 · 11:00" chips.
 *
 * All inputs/outputs that describe a wall-clock time use the same local
 * `YYYY-MM-DDTHH:mm` shape as an `<input type="datetime-local">`, so the card
 * can drop a suggestion straight into its "When" field. Busy blocks are ISO
 * strings (with or without an offset) and are parsed with `new Date(...)`,
 * exactly like the overlap check the card already relied on.
 */

export type FreeSlotOptions = {
  /** Calendar day to search, `YYYY-MM-DD` (local). */
  dateYmd: string
  busy: BusyBlock[]
  durationMinutes: number
  /** Reference clock; slots must start strictly after this. Defaults to `new Date()`. */
  now?: Date
  /**
   * Optional local `YYYY-MM-DDTHH:mm` anchor. When it falls on `dateYmd`, only
   * slots starting at or after it are proposed — so suggestions cluster around
   * the time the operator already picked rather than always starting at 08:00.
   */
  from?: string | null
  limit?: number
  dayStartHour?: number
  dayEndHour?: number
  stepMinutes?: number
}

export const DEFAULT_FREE_SLOT_LIMIT = 3
export const DEFAULT_DAY_START_HOUR = 8
export const DEFAULT_DAY_END_HOUR = 17
export const DEFAULT_STEP_MINUTES = 30

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

const pad = (value: number) => String(value).padStart(2, '0')

/** Local `YYYY-MM-DDTHH:mm` for a Date (what `<input type="datetime-local">` expects). */
export function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Parse a local `YYYY-MM-DDTHH:mm` string; null when malformed. */
export function parseLocalDateTime(value: string | null | undefined): Date | null {
  const match = typeof value === 'string' ? LOCAL_DATETIME.exec(value) : null
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "HH:mm" for a local `YYYY-MM-DDTHH:mm` string (falls back to the input). */
export function slotTimeLabel(local: string): string {
  const match = LOCAL_DATETIME.exec(local)
  return match ? `${match[4]}:${match[5]}` : local
}

/** True when [start, end) intersects the busy block. Unparsable blocks never overlap. */
export function overlaps(block: BusyBlock, start: Date, end: Date): boolean {
  const blockStart = new Date(block.start).getTime()
  const blockEnd = new Date(block.end).getTime()
  if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return false
  return start.getTime() < blockEnd && end.getTime() > blockStart
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Propose up to `limit` free slots on `dateYmd`, as local `YYYY-MM-DDTHH:mm`.
 *
 * - Candidates are aligned to `stepMinutes` counting from `dayStartHour`.
 * - `[start, start + duration)` must end by `dayEndHour`.
 * - A slot must not overlap any (parsable) busy block.
 * - A slot must start strictly after `now` — which is only a constraint when
 *   `dateYmd` is today (past days yield nothing, future days are unaffected).
 * - With `from` on the same day, slots before it are skipped.
 */
export function suggestFreeSlots({
  dateYmd,
  busy,
  durationMinutes,
  now = new Date(),
  from = null,
  limit = DEFAULT_FREE_SLOT_LIMIT,
  dayStartHour = DEFAULT_DAY_START_HOUR,
  dayEndHour = DEFAULT_DAY_END_HOUR,
  stepMinutes = DEFAULT_STEP_MINUTES,
}: FreeSlotOptions): string[] {
  const match = YMD.exec(dateYmd)
  if (!match) return []
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const dayStart = new Date(year, monthIndex, day, 0, 0, 0, 0)
  if (Number.isNaN(dayStart.getTime()) || dayStart.getMonth() !== monthIndex || dayStart.getDate() !== day) return []

  const duration = positiveOr(durationMinutes, DEFAULT_STEP_MINUTES)
  const step = positiveOr(stepMinutes, DEFAULT_STEP_MINUTES)
  const max = Math.max(0, Math.floor(limit))
  if (max === 0) return []

  const windowStart = new Date(year, monthIndex, day, dayStartHour, 0, 0, 0).getTime()
  const windowEnd = new Date(year, monthIndex, day, dayEndHour, 0, 0, 0).getTime()
  const anchor = parseLocalDateTime(from)
  const floor = anchor && formatLocalDateTime(anchor).slice(0, 10) === dateYmd ? anchor.getTime() : Number.NEGATIVE_INFINITY
  const nowMs = now.getTime()
  const blocks = Array.isArray(busy) ? busy : []

  const slots: string[] = []
  for (let startMs = windowStart; startMs + duration * 60_000 <= windowEnd; startMs += step * 60_000) {
    if (startMs <= nowMs || startMs < floor) continue
    const start = new Date(startMs)
    const end = new Date(startMs + duration * 60_000)
    if (blocks.some((block) => overlaps(block, start, end))) continue
    slots.push(formatLocalDateTime(start))
    if (slots.length >= max) break
  }
  return slots
}

/**
 * First free, step-aligned slot on the same day starting at or after
 * `startLocal` (local `YYYY-MM-DDTHH:mm`), or null when the day is full.
 * Powers the "Next free: 10:30" chip when the chosen time overlaps a busy block.
 */
export function nextFreeSlotAfter(
  startLocal: string,
  busy: BusyBlock[],
  durationMinutes: number,
  options: Pick<FreeSlotOptions, 'now' | 'dayStartHour' | 'dayEndHour' | 'stepMinutes'> = {},
): string | null {
  if (!parseLocalDateTime(startLocal)) return null
  const [slot] = suggestFreeSlots({
    ...options,
    dateYmd: startLocal.slice(0, 10),
    busy,
    durationMinutes,
    from: startLocal,
    limit: 1,
  })
  return slot ?? null
}
