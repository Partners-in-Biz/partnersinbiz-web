export type HabitCadence = 'daily' | 'weekly' | 'custom'
export type HabitStatus = 'active' | 'paused' | 'archived'
export type HabitHealthStatus = 'steady' | 'building' | 'needs-recovery' | 'paused'

export type HabitSchedule = {
  cadence: HabitCadence
  daysOfWeek?: number[]
  targetPerWeek?: number
  timeOfDay?: string
  timezone?: string
}

export type HabitInput = {
  orgId: string
  ownerId: string
  title: string
  description?: string
  schedule?: Partial<HabitSchedule>
  anchor?: string
  minimumViableAction?: string
  startDate?: string
}

export type HabitRecord = {
  id: string
  orgId: string
  ownerId: string
  title: string
  description: string | null
  status: HabitStatus
  schedule: HabitSchedule
  anchor: string | null
  minimumViableAction: string
  startDate: string
  shameFreeCopy: string
  createdAt: string
  updatedAt: string
}

export type HabitCheckInInput = {
  localDate: string
  completed: boolean
  frictionReasons?: string[]
  note?: string
}

export type HabitCheckIn = {
  id: string
  orgId: string
  habitId: string
  ownerId: string
  localDate: string
  completed: boolean
  frictionReasons: string[]
  note: string | null
  recoverySuggestion: string | null
  createdAt: string
  updatedAt: string
}

export type HabitHealthSummary = {
  habitId: string
  title: string
  currentStreak: number
  bestStreak: number
  momentumScore: number
  missedScheduledDates: string[]
  frictionReasons: Array<{ reason: string; count: number }>
  recoverySuggestion: string
  weekly: {
    weekStart: string
    weekEnd: string
    completed: number
    scheduled: number
    healthStatus: HabitHealthStatus
    summary: string
  }
}

const SHAME_FREE_COPY = 'This habit is about sustainable consistency, not perfection. Misses are useful data for making the next step easier.'

function stableId(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(':').toLowerCase().replace(/[^a-z0-9:-]+/g, '-').replace(/-+/g, '-').slice(0, 160)
}

function isoDateFromInstant(instant: string) {
  return instant.slice(0, 10)
}

function parseLocalDate(localDate: string) {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatLocalDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(localDate: string, days: number) {
  const date = parseLocalDate(localDate)
  date.setUTCDate(date.getUTCDate() + days)
  return formatLocalDate(date)
}

function dayOfWeek(localDate: string) {
  return parseLocalDate(localDate).getUTCDay()
}

function normalizeSchedule(input?: Partial<HabitSchedule>): HabitSchedule {
  const cadence = input?.cadence ?? 'daily'
  const daysOfWeek = Array.from(new Set((input?.daysOfWeek ?? (cadence === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : []))
    .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)))
    .sort((a, b) => a - b)

  return {
    cadence,
    daysOfWeek: cadence === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : daysOfWeek,
    targetPerWeek: Math.max(1, Math.min(7, Number(input?.targetPerWeek ?? (cadence === 'daily' ? 7 : Math.max(daysOfWeek.length, 1))))),
    timeOfDay: typeof input?.timeOfDay === 'string' && /^\d{2}:\d{2}$/.test(input.timeOfDay) ? input.timeOfDay : undefined,
    timezone: input?.timezone?.trim() || 'UTC',
  }
}

export function buildHabitRecord(input: HabitInput, now = new Date().toISOString()): HabitRecord {
  const title = input.title.trim()
  if (!input.orgId?.trim()) throw new Error('orgId is required')
  if (!input.ownerId?.trim()) throw new Error('ownerId is required')
  if (!title) throw new Error('title is required')

  const startDate = input.startDate?.trim() || isoDateFromInstant(now)
  return {
    id: stableId([input.orgId, input.ownerId, title, startDate]),
    orgId: input.orgId.trim(),
    ownerId: input.ownerId.trim(),
    title,
    description: input.description?.trim() || null,
    status: 'active',
    schedule: normalizeSchedule(input.schedule),
    anchor: input.anchor?.trim() || null,
    minimumViableAction: input.minimumViableAction?.trim() || `Do the smallest useful version of ${title}`,
    startDate,
    shameFreeCopy: SHAME_FREE_COPY,
    createdAt: now,
    updatedAt: now,
  }
}

export function suggestHabitRecovery(input: {
  habitTitle: string
  minimumViableAction: string
  recentFrictionReasons?: string[]
  missedScheduledDates?: string[]
}) {
  const reasons = input.recentFrictionReasons ?? []
  const topReason = reasons.reduce<Record<string, number>>((acc, reason) => {
    acc[reason] = (acc[reason] ?? 0) + 1
    return acc
  }, {})
  const repeated = Object.entries(topReason).sort((a, b) => b[1] - a[1])[0]?.[0]
  const missedCount = input.missedScheduledDates?.length ?? 0
  const base = `Restart with the smallest version: ${input.minimumViableAction}.`

  if (repeated?.includes('tired') || repeated?.includes('energy')) {
    return `${base} Since energy has been the main friction, move it earlier, lower the effort, or pair it with an existing rest-friendly cue.`
  }
  if (repeated?.includes('forgot')) {
    return `${base} Add a visible cue or reminder near the moment it should happen, then treat the next check-in as a clean restart.`
  }
  if (repeated?.includes('busy') || repeated?.includes('time')) {
    return `${base} Protect a two-minute version first; once that feels easy, extend it.`
  }
  if (missedCount > 1) {
    return `${base} Keep the next attempt deliberately easy so momentum can rebuild without pressure.`
  }
  return `${base} One miss is feedback, not a verdict; use it to make the next attempt easier.`
}

export function buildHabitCheckIn(habit: HabitRecord, input: HabitCheckInInput, now = new Date().toISOString()): HabitCheckIn {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)) throw new Error('localDate must be YYYY-MM-DD')
  const frictionReasons = Array.from(new Set((input.frictionReasons ?? []).map((reason) => reason.trim()).filter(Boolean))).slice(0, 8)
  return {
    id: stableId([habit.id, input.localDate]),
    orgId: habit.orgId,
    habitId: habit.id,
    ownerId: habit.ownerId,
    localDate: input.localDate,
    completed: Boolean(input.completed),
    frictionReasons,
    note: input.note?.trim() || null,
    recoverySuggestion: input.completed ? null : suggestHabitRecovery({
      habitTitle: habit.title,
      minimumViableAction: habit.minimumViableAction,
      recentFrictionReasons: frictionReasons,
      missedScheduledDates: [input.localDate],
    }),
    createdAt: now,
    updatedAt: now,
  }
}

function scheduledDatesBetween(habit: HabitRecord, start: string, end: string) {
  const dates: string[] = []
  const scheduleDays = new Set(habit.schedule.daysOfWeek ?? [])
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (cursor < habit.startDate) continue
    if (habit.schedule.cadence === 'custom') {
      if (dates.length < (habit.schedule.targetPerWeek ?? 1) && scheduleDays.has(dayOfWeek(cursor))) dates.push(cursor)
    } else if (scheduleDays.has(dayOfWeek(cursor))) {
      dates.push(cursor)
    }
  }
  return dates
}

function byDate(checkIns: HabitCheckIn[]) {
  const map = new Map<string, HabitCheckIn>()
  for (const checkIn of checkIns) {
    if (!map.has(checkIn.localDate) || checkIn.updatedAt > (map.get(checkIn.localDate)?.updatedAt ?? '')) {
      map.set(checkIn.localDate, checkIn)
    }
  }
  return map
}

function rankFriction(checkIns: HabitCheckIn[]) {
  const counts = new Map<string, number>()
  for (const checkIn of checkIns) {
    if (checkIn.completed) continue
    for (const reason of checkIn.frictionReasons) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

function streaks(scheduledDates: string[], checkInsByDate: Map<string, HabitCheckIn>) {
  let current = 0
  let best = 0
  let running = 0
  for (const date of scheduledDates) {
    if (checkInsByDate.get(date)?.completed) {
      running += 1
      best = Math.max(best, running)
    } else {
      running = 0
    }
  }
  for (let index = scheduledDates.length - 1; index >= 0; index -= 1) {
    if (checkInsByDate.get(scheduledDates[index])?.completed) current += 1
    else break
  }
  return { current, best }
}

export function summarizeHabitHealth(habit: HabitRecord, checkIns: HabitCheckIn[], options?: { today?: string; weekStart?: string }): HabitHealthSummary {
  const today = options?.today ?? formatLocalDate(new Date())
  const weekStart = options?.weekStart ?? addDays(today, -dayOfWeek(today))
  const weekEnd = addDays(weekStart, 6)
  const checkInsByDate = byDate(checkIns.filter((checkIn) => checkIn.habitId === habit.id))
  const scheduledToToday = scheduledDatesBetween(habit, habit.startDate, today)
  const weeklyDates = scheduledDatesBetween(habit, weekStart, weekEnd)
  const missedScheduledDates = scheduledToToday.filter((date) => !checkInsByDate.get(date)?.completed)
  const completedWeekly = weeklyDates.filter((date) => checkInsByDate.get(date)?.completed).length
  const momentumScore = weeklyDates.length === 0 ? 0 : Math.round((completedWeekly / weeklyDates.length) * 100)
  const ratio = weeklyDates.length === 0 ? 0 : completedWeekly / weeklyDates.length
  const healthStatus: HabitHealthStatus = habit.status === 'paused'
    ? 'paused'
    : ratio >= 0.7
      ? 'steady'
      : ratio >= 0.35
        ? 'building'
        : 'needs-recovery'
  const latestAnsweredDate = Array.from(checkInsByDate.keys()).sort().at(-1) ?? today
  const scheduledForStreak = scheduledToToday.filter((date) => date <= latestAnsweredDate)
  const streak = streaks(scheduledForStreak, checkInsByDate)
  const frictionReasons = rankFriction(Array.from(checkInsByDate.values()))
  const recoverySuggestion = suggestHabitRecovery({
    habitTitle: habit.title,
    minimumViableAction: habit.minimumViableAction,
    recentFrictionReasons: frictionReasons.flatMap((item) => Array(item.count).fill(item.reason)),
    missedScheduledDates,
  })

  return {
    habitId: habit.id,
    title: habit.title,
    currentStreak: streak.current,
    bestStreak: streak.best,
    momentumScore,
    missedScheduledDates,
    frictionReasons,
    recoverySuggestion,
    weekly: {
      weekStart,
      weekEnd,
      completed: completedWeekly,
      scheduled: weeklyDates.length,
      healthStatus,
      summary: `${completedWeekly} of ${weeklyDates.length} scheduled check-ins completed. ${healthStatus === 'steady' ? 'Momentum is steady; keep the next step easy to repeat.' : 'Use the friction notes to make next week lighter and easier to restart.'}`,
    },
  }
}
