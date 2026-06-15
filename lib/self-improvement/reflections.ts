export type ReflectionType = 'daily' | 'weekly'

export interface ReflectionInput {
  orgId: string
  ownerId: string
  wins?: string[]
  misses?: string[]
  lessons?: string[]
  energy: number
  mood: number
  blockers?: string[]
  priorities?: string[]
  nextExperiments?: string[]
}

export interface DailyCheckInInput extends ReflectionInput {
  localDate: string
}

export interface WeeklyReviewInput extends ReflectionInput {
  weekStart: string
  weekEnd: string
}

export interface ReflectionDashboardSignals {
  winCount: number
  missCount: number
  lessonCount: number
  blockerCount: number
  priorityCount: number
  experimentCount: number
  energyMoodAverage: number
}

export interface ReflectionCoachContext {
  emotionalTone: 'steady' | 'low-energy' | 'strained' | 'high-momentum'
  blockerThemes: string[]
  priorityThemes: string[]
  experimentThemes: string[]
  nextCoachPrompt: string
}

export interface DailyCheckInRecord {
  id: string
  type: 'daily'
  orgId: string
  ownerId: string
  localDate: string
  wins: string[]
  misses: string[]
  lessons: string[]
  energy: number
  mood: number
  blockers: string[]
  priorities: string[]
  nextExperiments: string[]
  coachContext: ReflectionCoachContext
  dashboardSignals: ReflectionDashboardSignals
  createdAt: string
  updatedAt: string
}

export interface WeeklyReviewRecord {
  id: string
  periodType: 'weekly'
  orgId: string
  ownerId: string
  periodStart: string
  periodEnd: string
  summary: string
  wins: string[]
  misses: string[]
  lessons: string[]
  energy: number
  mood: number
  blockers: string[]
  priorities: string[]
  nextExperiments: string[]
  coachContext: ReflectionCoachContext
  dashboardSignals: ReflectionDashboardSignals
  createdAt: string
  updatedAt: string
}

export interface ReflectionInsightsSummary {
  totalWins: number
  totalMisses: number
  totalLessons: number
  totalBlockers: number
  averageEnergy: number
  averageMood: number
  activeExperiments: string[]
  coachBrief: string
}

type ReflectionRecord = DailyCheckInRecord | WeeklyReviewRecord

function stableId(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(':').toLowerCase().replace(/[^a-z0-9:-]+/g, '-').replace(/-+/g, '-').slice(0, 160)
}

function normalizeList(values?: string[], limit = 12) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, limit)
}

function validateOrgOwner(input: ReflectionInput) {
  if (!input.orgId?.trim()) throw new Error('orgId is required')
  if (!input.ownerId?.trim()) throw new Error('ownerId is required')
}

function validateDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
}

function normalizeScore(value: number, label: string) {
  if (!Number.isFinite(value) || value < 1 || value > 5) throw new Error(`${label} must be between 1 and 5`)
  return Math.round(value)
}

function buildDashboardSignals(input: Required<Pick<ReflectionInput, 'wins' | 'misses' | 'lessons' | 'blockers' | 'priorities' | 'nextExperiments'>> & Pick<ReflectionInput, 'energy' | 'mood'>): ReflectionDashboardSignals {
  return {
    winCount: input.wins.length,
    missCount: input.misses.length,
    lessonCount: input.lessons.length,
    blockerCount: input.blockers.length,
    priorityCount: input.priorities.length,
    experimentCount: input.nextExperiments.length,
    energyMoodAverage: Number(((input.energy + input.mood) / 2).toFixed(1)),
  }
}

function emotionalTone(energy: number, mood: number): ReflectionCoachContext['emotionalTone'] {
  if (energy <= 2) return 'low-energy'
  if (mood <= 2) return 'strained'
  if (energy >= 4 && mood >= 4) return 'high-momentum'
  return 'steady'
}

function buildCoachContext(input: Required<Pick<ReflectionInput, 'blockers' | 'priorities' | 'nextExperiments'>> & Pick<ReflectionInput, 'energy' | 'mood' | 'misses'>): ReflectionCoachContext {
  const priority = input.priorities[0] ?? 'choose one honest next priority'
  const experiment = input.nextExperiments[0] ?? 'run one smaller experiment before adding more work'
  const blocker = input.blockers[0] ?? input.misses?.[0] ?? 'no major blocker captured'

  return {
    emotionalTone: emotionalTone(input.energy, input.mood),
    blockerThemes: input.blockers,
    priorityThemes: input.priorities,
    experimentThemes: input.nextExperiments,
    nextCoachPrompt: `Coach the user around "${priority}". Account for blocker: "${blocker}". Suggest or refine experiment: "${experiment}".`,
  }
}

function normalizeReflectionInput(input: ReflectionInput) {
  validateOrgOwner(input)
  const energy = normalizeScore(input.energy, 'energy')
  const mood = normalizeScore(input.mood, 'mood')
  const normalized = {
    orgId: input.orgId.trim(),
    ownerId: input.ownerId.trim(),
    wins: normalizeList(input.wins),
    misses: normalizeList(input.misses),
    lessons: normalizeList(input.lessons),
    energy,
    mood,
    blockers: normalizeList(input.blockers),
    priorities: normalizeList(input.priorities),
    nextExperiments: normalizeList(input.nextExperiments),
  }

  return {
    ...normalized,
    dashboardSignals: buildDashboardSignals(normalized),
    coachContext: buildCoachContext(normalized),
  }
}

export function buildDailyCheckIn(input: DailyCheckInInput, now = new Date().toISOString()): DailyCheckInRecord {
  validateDate(input.localDate, 'localDate')
  const normalized = normalizeReflectionInput(input)

  return {
    id: stableId([normalized.orgId, normalized.ownerId, 'daily', input.localDate]),
    type: 'daily',
    ...normalized,
    localDate: input.localDate,
    createdAt: now,
    updatedAt: now,
  }
}

export function buildWeeklyReview(input: WeeklyReviewInput, now = new Date().toISOString()): WeeklyReviewRecord {
  validateDate(input.weekStart, 'weekStart')
  validateDate(input.weekEnd, 'weekEnd')
  if (input.weekEnd < input.weekStart) throw new Error('weekEnd must be on or after weekStart')
  const normalized = normalizeReflectionInput(input)
  const leadWin = normalized.wins[0] ?? 'No wins captured yet'
  const leadLesson = normalized.lessons[0] ?? 'Capture one lesson before planning the next week'
  const leadExperiment = normalized.nextExperiments[0] ?? 'Choose one small next experiment'

  return {
    id: stableId([normalized.orgId, normalized.ownerId, 'weekly', input.weekStart, input.weekEnd]),
    periodType: 'weekly',
    ...normalized,
    periodStart: input.weekStart,
    periodEnd: input.weekEnd,
    summary: `${leadWin}. Lesson: ${leadLesson}. Next experiment: ${leadExperiment}.`,
    createdAt: now,
    updatedAt: now,
  }
}

function collect(records: ReflectionRecord[], field: 'wins' | 'misses' | 'lessons' | 'blockers' | 'nextExperiments') {
  return records.flatMap((record) => record[field])
}

function average(records: ReflectionRecord[], field: 'energy' | 'mood') {
  if (records.length === 0) return 0
  return Number((records.reduce((total, record) => total + record[field], 0) / records.length).toFixed(1))
}

export function summarizeReflectionInsights(dailyCheckIns: DailyCheckInRecord[], weeklyReviews: WeeklyReviewRecord[]): ReflectionInsightsSummary {
  const records: ReflectionRecord[] = [...dailyCheckIns, ...weeklyReviews]
  const wins = collect(records, 'wins')
  const misses = collect(records, 'misses')
  const lessons = collect(records, 'lessons')
  const blockers = collect(records, 'blockers')
  const activeExperiments = normalizeList(collect(records, 'nextExperiments'), 20)

  return {
    totalWins: wins.length,
    totalMisses: misses.length,
    totalLessons: lessons.length,
    totalBlockers: blockers.length,
    averageEnergy: average(records, 'energy'),
    averageMood: average(records, 'mood'),
    activeExperiments,
    coachBrief: `${wins.length} wins, ${misses.length} misses, ${lessons.length} lessons, and ${blockers.length} blockers captured. Use the next experiment list to coach the next smallest adjustment.`,
  }
}
