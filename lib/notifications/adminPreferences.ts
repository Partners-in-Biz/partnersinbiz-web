import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const ADMIN_NOTIFICATION_EVENT_CLASSES = [
  'client_acceptance',
  'approval',
  'mention',
  'task',
  'comment',
  'billing',
  'crm',
  'system',
] as const

export type AdminNotificationEventClass = (typeof ADMIN_NOTIFICATION_EVENT_CLASSES)[number]

export type AdminNotificationChannels = {
  inApp: boolean
  push: boolean
  email: boolean
}

export type AdminNotificationPreference = {
  userId: string
  orgId: string
  channels: AdminNotificationChannels
  eventClasses: Record<AdminNotificationEventClass, AdminNotificationChannels>
  createdAt?: unknown
  updatedAt?: unknown
  updatedBy?: string
  updatedByType?: string
}

type StoredAdminNotificationPreference = Partial<Omit<AdminNotificationPreference, 'channels' | 'eventClasses'>> & {
  channels?: Partial<AdminNotificationChannels>
  eventClasses?: Partial<Record<AdminNotificationEventClass, Partial<AdminNotificationChannels>>>
}

const DEFAULT_CHANNELS: AdminNotificationChannels = { inApp: true, push: true, email: true }

const EVENT_CLASS_DEFAULTS: Record<AdminNotificationEventClass, AdminNotificationChannels> = {
  client_acceptance: { inApp: true, push: true, email: true },
  approval: { inApp: true, push: true, email: true },
  mention: { inApp: true, push: true, email: true },
  task: { inApp: true, push: false, email: false },
  comment: { inApp: true, push: false, email: false },
  billing: { inApp: true, push: true, email: true },
  crm: { inApp: true, push: false, email: false },
  system: { inApp: true, push: true, email: true },
}

function channelValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function preferenceDocId(userId: string, orgId: string): string {
  return `${userId}__${orgId}`
}

export function buildDefaultAdminNotificationPreference(userId: string, orgId: string): AdminNotificationPreference {
  return {
    userId,
    orgId,
    channels: { ...DEFAULT_CHANNELS },
    eventClasses: Object.fromEntries(
      ADMIN_NOTIFICATION_EVENT_CLASSES.map((eventClass) => [eventClass, { ...EVENT_CLASS_DEFAULTS[eventClass] }]),
    ) as Record<AdminNotificationEventClass, AdminNotificationChannels>,
  }
}

export function normaliseChannels(
  value: Partial<AdminNotificationChannels> | undefined,
  fallback: AdminNotificationChannels,
): AdminNotificationChannels {
  return {
    inApp: channelValue(value?.inApp, fallback.inApp),
    push: channelValue(value?.push, fallback.push),
    email: channelValue(value?.email, fallback.email),
  }
}

export function normaliseAdminNotificationPreference(
  stored: StoredAdminNotificationPreference | undefined,
  userId: string,
  orgId: string,
): AdminNotificationPreference {
  const defaults = buildDefaultAdminNotificationPreference(userId, orgId)
  const eventClasses = { ...defaults.eventClasses }

  for (const eventClass of ADMIN_NOTIFICATION_EVENT_CLASSES) {
    eventClasses[eventClass] = normaliseChannels(stored?.eventClasses?.[eventClass], defaults.eventClasses[eventClass])
  }

  return {
    ...defaults,
    ...stored,
    userId,
    orgId,
    channels: normaliseChannels(stored?.channels, defaults.channels),
    eventClasses,
  }
}

export function canAdminManageNotificationPreference(user: ApiUser | null | undefined, orgId: string): boolean {
  return Boolean(user && user.role === 'admin' && canAccessOrg(user, orgId))
}

export function sanitisePreferenceUpdate(body: unknown): {
  channels?: AdminNotificationChannels
  eventClasses?: Partial<Record<AdminNotificationEventClass, AdminNotificationChannels>>
} {
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const update: {
    channels?: AdminNotificationChannels
    eventClasses?: Partial<Record<AdminNotificationEventClass, AdminNotificationChannels>>
  } = {}

  if (typeof input.channels === 'object' && input.channels !== null) {
    update.channels = normaliseChannels(input.channels as Partial<AdminNotificationChannels>, DEFAULT_CHANNELS)
  }

  if (typeof input.eventClasses === 'object' && input.eventClasses !== null) {
    const incoming = input.eventClasses as Record<string, unknown>
    const eventClasses: Partial<Record<AdminNotificationEventClass, AdminNotificationChannels>> = {}

    for (const eventClass of ADMIN_NOTIFICATION_EVENT_CLASSES) {
      const value = incoming[eventClass]
      if (typeof value === 'object' && value !== null) {
        eventClasses[eventClass] = normaliseChannels(
          value as Partial<AdminNotificationChannels>,
          EVENT_CLASS_DEFAULTS[eventClass],
        )
      }
    }

    if (Object.keys(eventClasses).length > 0) update.eventClasses = eventClasses
  }

  return update
}
