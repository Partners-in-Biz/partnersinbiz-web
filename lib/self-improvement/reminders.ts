export type ReminderKind = 'daily-check-in' | 'habit-prompt' | 'weekly-review' | 'recovery-nudge'
export type ReminderStatus = 'scheduled' | 'sent' | 'suppressed' | 'dismissed'
export type ReminderSuppressionReason = 'consent-required' | 'kind-disabled' | 'quiet-hours' | 'notification-channel-disabled' | 'not-yet-due'

export interface ReminderChannels {
  inApp: boolean
  push: boolean
  email: boolean
}

export interface QuietHoursPreference {
  start: string
  end: string
  timezone: string
}

export interface ReminderPreferencesInput {
  orgId: string
  ownerId: string
  optedIn?: boolean
  channels?: Partial<ReminderChannels>
  quietHours?: Partial<QuietHoursPreference>
  enabledKinds?: ReminderKind[]
}

export interface ReminderPreferences {
  id: string
  orgId: string
  ownerId: string
  optedIn: boolean
  channels: ReminderChannels
  quietHours: QuietHoursPreference
  enabledKinds: ReminderKind[]
  consentUpdatedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ReminderTarget {
  type: 'life-os-check-in' | 'life-os-review' | 'habit' | 'daily-action'
  id: string
}

export interface ReminderCandidate {
  orgId?: string
  ownerId?: string
  kind: ReminderKind
  title: string
  body: string
  localDate: string
  preferredTime: string
  timezone?: string
  target: ReminderTarget
}

export interface ReminderRecord {
  id: string
  orgId: string
  ownerId: string
  kind: ReminderKind
  title: string
  body: string
  status: ReminderStatus
  scheduledFor: string
  localDate: string
  timezone: string
  channels: ReminderChannels
  target: ReminderTarget
  consentSnapshot: Pick<ReminderPreferences, 'optedIn' | 'enabledKinds' | 'channels' | 'quietHours'>
  createdAt: string
  updatedAt: string
}

export interface ReminderDueResult {
  due: boolean
  reason?: ReminderSuppressionReason
  scheduledFor: string
  nextEligibleAt?: string
}

const reminderKinds: ReminderKind[] = ['daily-check-in', 'habit-prompt', 'weekly-review', 'recovery-nudge']
const defaultTimezone = 'Africa/Johannesburg'
const defaultQuietHours: QuietHoursPreference = { start: '21:00', end: '07:00', timezone: defaultTimezone }
const defaultChannels: ReminderChannels = { inApp: true, push: false, email: false }

export function buildReminderPreferences(input: ReminderPreferencesInput, now = new Date().toISOString()): ReminderPreferences {
  const orgId = input.orgId?.trim()
  const ownerId = input.ownerId?.trim()
  if (!orgId) throw new Error('orgId is required')
  if (!ownerId) throw new Error('ownerId is required')

  const optedIn = input.optedIn === true
  return {
    id: preferenceId(orgId, ownerId),
    orgId,
    ownerId,
    optedIn,
    channels: {
      ...defaultChannels,
      ...input.channels,
      inApp: input.channels?.inApp ?? true,
    },
    quietHours: {
      ...defaultQuietHours,
      ...input.quietHours,
      timezone: input.quietHours?.timezone?.trim() || defaultQuietHours.timezone,
    },
    enabledKinds: normalizeKinds(input.enabledKinds),
    consentUpdatedAt: input.optedIn === undefined ? undefined : now,
    createdAt: now,
    updatedAt: now,
  }
}

export function evaluateReminderDue(candidate: ReminderCandidate, preferences: ReminderPreferences, now = new Date().toISOString()): ReminderDueResult {
  const timezone = candidate.timezone || preferences.quietHours.timezone || defaultTimezone
  const scheduledFor = localDateTimeToIso(candidate.localDate, candidate.preferredTime, timezone)

  if (!preferences.optedIn) return { due: false, reason: 'consent-required', scheduledFor }
  if (!preferences.enabledKinds.includes(candidate.kind)) return { due: false, reason: 'kind-disabled', scheduledFor }
  if (!preferences.channels.inApp && !preferences.channels.push && !preferences.channels.email) {
    return { due: false, reason: 'notification-channel-disabled', scheduledFor }
  }

  const localNow = getLocalParts(now, preferences.quietHours.timezone)
  if (isQuietTime(localNow.timeMinutes, preferences.quietHours)) {
    return {
      due: false,
      reason: 'quiet-hours',
      scheduledFor,
      nextEligibleAt: nextQuietHoursEnd(now, preferences.quietHours),
    }
  }

  if (Date.parse(now) < Date.parse(scheduledFor)) return { due: false, reason: 'not-yet-due', scheduledFor }

  return { due: true, scheduledFor }
}

export function buildReminderSchedule(candidates: ReminderCandidate[], preferences: ReminderPreferences, now = new Date().toISOString()): ReminderRecord[] {
  return candidates.map((candidate) => buildReminderRecord(candidate, preferences, now))
}

export function buildReminderRecord(candidate: ReminderCandidate, preferences: ReminderPreferences, now = new Date().toISOString()): ReminderRecord {
  const orgId = candidate.orgId?.trim() || preferences.orgId
  const ownerId = candidate.ownerId?.trim() || preferences.ownerId
  const timezone = candidate.timezone || preferences.quietHours.timezone || defaultTimezone
  if (!candidate.title?.trim()) throw new Error('title is required')
  if (!candidate.body?.trim()) throw new Error('body is required')
  validateLocalDate(candidate.localDate)
  validateTime(candidate.preferredTime, 'preferredTime')
  const scheduledFor = localDateTimeToIso(candidate.localDate, candidate.preferredTime, timezone)

  return {
    id: stableId([orgId, ownerId, candidate.kind, candidate.localDate, candidate.preferredTime, candidate.target.type, candidate.target.id]),
    orgId,
    ownerId,
    kind: candidate.kind,
    title: candidate.title.trim(),
    body: candidate.body.trim(),
    status: 'scheduled',
    scheduledFor,
    localDate: candidate.localDate,
    timezone,
    channels: preferences.channels,
    target: candidate.target,
    consentSnapshot: {
      optedIn: preferences.optedIn,
      enabledKinds: preferences.enabledKinds,
      channels: preferences.channels,
      quietHours: preferences.quietHours,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function preferenceId(orgId: string, ownerId: string) {
  return stableId([orgId, ownerId])
}

function normalizeKinds(kinds?: ReminderKind[]) {
  if (!kinds || kinds.length === 0) return reminderKinds
  return Array.from(new Set(kinds.filter((kind): kind is ReminderKind => reminderKinds.includes(kind))))
}

function stableId(parts: string[]) {
  return parts.join(':').toLowerCase().replace(/[^a-z0-9:-]+/g, '-').replace(/-+/g, '-').slice(0, 180)
}

function validateLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('localDate must be YYYY-MM-DD')
}

function validateTime(value: string, label: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error(`${label} must be HH:mm`)
  const [hour, minute] = value.split(':').map(Number)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`${label} must be a valid HH:mm value`)
}

function localDateTimeToIso(localDate: string, time: string, timezone: string) {
  validateLocalDate(localDate)
  validateTime(time, 'time')
  const offset = timezoneOffsetFor(timezone, localDate)
  return `${localDate}T${time}:00.000${offset}`
}

function timezoneOffsetFor(timezone: string, localDate: string) {
  if (timezone === 'UTC') return '+00:00'
  if (timezone === 'Africa/Johannesburg') return '+02:00'

  const sampleUtc = new Date(`${localDate}T12:00:00.000Z`)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(sampleUtc)
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = offset.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return '+00:00'
  const [, sign, hour, minute = '00'] = match
  return `${sign}${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

function getLocalParts(iso: string, timezone: string) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const lookup = new Map(parts.map((part) => [part.type, part.value]))
  const hour = Number(lookup.get('hour') ?? 0)
  const minute = Number(lookup.get('minute') ?? 0)
  return {
    date: `${lookup.get('year')}-${lookup.get('month')}-${lookup.get('day')}`,
    timeMinutes: hour * 60 + minute,
  }
}

function minutes(value: string) {
  validateTime(value, 'quietHours')
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function isQuietTime(timeMinutes: number, quietHours: QuietHoursPreference) {
  const start = minutes(quietHours.start)
  const end = minutes(quietHours.end)
  if (start === end) return false
  if (start < end) return timeMinutes >= start && timeMinutes < end
  return timeMinutes >= start || timeMinutes < end
}

function nextQuietHoursEnd(now: string, quietHours: QuietHoursPreference) {
  const local = getLocalParts(now, quietHours.timezone)
  const end = minutes(quietHours.end)
  const current = local.timeMinutes
  const date = current < end ? local.date : addDays(local.date, 1)
  return localDateTimeToIso(date, quietHours.end, quietHours.timezone)
}

function addDays(localDate: string, days: number) {
  const date = new Date(`${localDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
