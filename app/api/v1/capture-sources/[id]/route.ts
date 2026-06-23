// app/api/v1/capture-sources/[id]/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import {
  CaptureSource,
  DEFAULT_WIDGET_THEME,
  DEFAULT_RATE_LIMIT,
  LEAD_CAPTURE_SOURCES,
  VALID_CAPTURE_TYPES,
  VALID_FIELD_TYPES,
  type CaptureField,
  type CaptureSourceRateLimit,
  type CaptureWidgetTheme,
  type DoubleOptInMode,
  type WidgetDisplayConfig,
  type WidgetDisplayMode,
  type WidgetDisplayStep,
  type WidgetPosition,
} from '@/lib/lead-capture/types'

const VALID_DISPLAY_MODES: WidgetDisplayMode[] = [
  'inline',
  'popup',
  'slide-in',
  'exit-intent',
  'multi-step',
]
const VALID_POSITIONS: WidgetPosition[] = [
  'center',
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
]

function sanitizeDisplaySteps(input: unknown): WidgetDisplayStep[] {
  if (!Array.isArray(input)) return []
  return input
    .map((raw): WidgetDisplayStep | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const headingText = typeof r.headingText === 'string' ? r.headingText : ''
      const subheadingText = typeof r.subheadingText === 'string' ? r.subheadingText : ''
      const buttonText = typeof r.buttonText === 'string' && r.buttonText.trim()
        ? r.buttonText.trim()
        : 'Continue'
      const fieldsArr = Array.isArray(r.fields)
        ? r.fields.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      return { headingText, subheadingText, buttonText, fields: fieldsArr }
    })
    .filter((s): s is WidgetDisplayStep => s !== null)
}

function sanitizeDisplay(input: unknown): WidgetDisplayConfig | undefined {
  if (input === null || input === undefined) return undefined
  if (typeof input !== 'object') return undefined
  const r = input as Record<string, unknown>
  const mode = (typeof r.mode === 'string' ? r.mode : 'inline') as WidgetDisplayMode
  if (!VALID_DISPLAY_MODES.includes(mode)) return undefined
  const out: WidgetDisplayConfig = { mode }
  if (typeof r.triggerDelaySeconds === 'number' && r.triggerDelaySeconds >= 0 && r.triggerDelaySeconds <= 3600) {
    out.triggerDelaySeconds = Math.floor(r.triggerDelaySeconds)
  }
  if (typeof r.triggerScrollPercent === 'number' && r.triggerScrollPercent >= 0 && r.triggerScrollPercent <= 100) {
    out.triggerScrollPercent = Math.floor(r.triggerScrollPercent)
  }
  if (typeof r.triggerPagesViewed === 'number' && r.triggerPagesViewed >= 0 && r.triggerPagesViewed <= 1000) {
    out.triggerPagesViewed = Math.floor(r.triggerPagesViewed)
  }
  if (typeof r.triggerOnExitIntent === 'boolean') out.triggerOnExitIntent = r.triggerOnExitIntent
  if (typeof r.dismissCooldownDays === 'number' && r.dismissCooldownDays >= 0 && r.dismissCooldownDays <= 3650) {
    out.dismissCooldownDays = Math.floor(r.dismissCooldownDays)
  }
  if (typeof r.suppressForSubscribedDays === 'number' && r.suppressForSubscribedDays >= 0 && r.suppressForSubscribedDays <= 3650) {
    out.suppressForSubscribedDays = Math.floor(r.suppressForSubscribedDays)
  }
  if (Array.isArray(r.showOnPaths)) {
    out.showOnPaths = r.showOnPaths.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  }
  if (Array.isArray(r.hideOnPaths)) {
    out.hideOnPaths = r.hideOnPaths.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  }
  if (typeof r.position === 'string' && VALID_POSITIONS.includes(r.position as WidgetPosition)) {
    out.position = r.position as WidgetPosition
  }
  if (r.steps !== undefined) {
    out.steps = sanitizeDisplaySteps(r.steps)
  }
  return out
}

function sanitizeRateLimit(input: unknown): CaptureSourceRateLimit {
  if (!input || typeof input !== 'object') return { ...DEFAULT_RATE_LIMIT }
  const r = input as Record<string, unknown>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_RATE_LIMIT.enabled,
    maxPerHourPerIp:
      typeof r.maxPerHourPerIp === 'number' && r.maxPerHourPerIp > 0
        ? Math.floor(r.maxPerHourPerIp)
        : DEFAULT_RATE_LIMIT.maxPerHourPerIp,
    maxPerDayPerEmail:
      typeof r.maxPerDayPerEmail === 'number' && r.maxPerDayPerEmail > 0
        ? Math.floor(r.maxPerDayPerEmail)
        : DEFAULT_RATE_LIMIT.maxPerDayPerEmail,
  }
}

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function sanitizeFields(input: unknown): CaptureField[] {
  if (!Array.isArray(input)) return []
  return input
    .map((raw): CaptureField | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const key = typeof r.key === 'string' ? r.key.trim() : ''
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      const type = (typeof r.type === 'string' ? r.type : 'text') as CaptureField['type']
      if (!key || !label) return null
      if (!VALID_FIELD_TYPES.includes(type)) return null
      const field: CaptureField = {
        key,
        label,
        type,
        required: r.required === true,
      }
      if (typeof r.placeholder === 'string') field.placeholder = r.placeholder
      if (Array.isArray(r.options)) {
        field.options = r.options.filter((o): o is string => typeof o === 'string')
      }
      return field
    })
    .filter((f): f is CaptureField => f !== null)
}

function sanitizeTheme(input: unknown): CaptureWidgetTheme {
  if (!input || typeof input !== 'object') return { ...DEFAULT_WIDGET_THEME }
  const r = input as Record<string, unknown>
  return {
    primaryColor: typeof r.primaryColor === 'string' ? r.primaryColor : DEFAULT_WIDGET_THEME.primaryColor,
    textColor: typeof r.textColor === 'string' ? r.textColor : DEFAULT_WIDGET_THEME.textColor,
    backgroundColor: typeof r.backgroundColor === 'string' ? r.backgroundColor : DEFAULT_WIDGET_THEME.backgroundColor,
    borderRadius: typeof r.borderRadius === 'number' ? r.borderRadius : DEFAULT_WIDGET_THEME.borderRadius,
    buttonText: typeof r.buttonText === 'string' && r.buttonText.trim() ? r.buttonText : DEFAULT_WIDGET_THEME.buttonText,
    headingText: typeof r.headingText === 'string' && r.headingText.trim() ? r.headingText : DEFAULT_WIDGET_THEME.headingText,
    subheadingText: typeof r.subheadingText === 'string' ? r.subheadingText : DEFAULT_WIDGET_THEME.subheadingText,
  }
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

// US-091: only accept http(s) webhook URLs; everything else → '' (disabled).
function sanitizeWebhookUrl(v: unknown): string {
  if (typeof v !== 'string') return ''
  const trimmed = v.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    return trimmed
  } catch {
    return ''
  }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const data = snap.data() as CaptureSource
  const scope = resolveOrgScope(user, data.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  // US-091: optionally include recent webhook deliveries for the settings UI.
  const { searchParams } = new URL(req.url)
  if (searchParams.get('includeDeliveries') === 'true') {
    const deliveriesLimit = Math.min(
      Math.max(parseInt(searchParams.get('deliveriesLimit') ?? '20', 10) || 20, 1),
      100,
    )
    let deliveries: Array<Record<string, unknown>> = []
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delSnap = await (adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).collection('deliveries') as any)
        .orderBy('createdAt', 'desc')
        .limit(deliveriesLimit)
        .get()
      deliveries = delSnap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({
        id: d.id,
        ...d.data(),
      }))
    } catch {
      deliveries = []
    }
    return apiSuccess({ ...data, id: snap.id, deliveries })
  }

  return apiSuccess({ ...data, id: snap.id })
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const existing = snap.data() as CaptureSource
  const scope = resolveOrgScope(user, existing.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

  const patch: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.type === 'string') {
    if (!VALID_CAPTURE_TYPES.includes(body.type)) {
      return apiError(`type must be one of: ${VALID_CAPTURE_TYPES.join(', ')}`, 400)
    }
    patch.type = body.type
  }
  if (body.doubleOptIn === 'on' || body.doubleOptIn === 'off') {
    patch.doubleOptIn = body.doubleOptIn as DoubleOptInMode
  }
  if (typeof body.confirmationSubject === 'string') patch.confirmationSubject = body.confirmationSubject
  if (typeof body.confirmationBodyHtml === 'string') patch.confirmationBodyHtml = body.confirmationBodyHtml
  if (typeof body.successMessage === 'string') patch.successMessage = body.successMessage
  if (typeof body.successRedirectUrl === 'string') patch.successRedirectUrl = body.successRedirectUrl
  if (body.fields !== undefined) patch.fields = sanitizeFields(body.fields)
  if (body.tagsToApply !== undefined) patch.tagsToApply = strArray(body.tagsToApply)
  if (body.campaignIdsToEnroll !== undefined) patch.campaignIdsToEnroll = strArray(body.campaignIdsToEnroll)
  if (body.sequenceIdsToEnroll !== undefined) patch.sequenceIdsToEnroll = strArray(body.sequenceIdsToEnroll)
  if (body.notifyEmails !== undefined) patch.notifyEmails = strArray(body.notifyEmails)
  if (body.widgetTheme !== undefined) patch.widgetTheme = sanitizeTheme(body.widgetTheme)
  if (typeof body.active === 'boolean') patch.active = body.active

  // Spam protection
  if (typeof body.turnstileEnabled === 'boolean') patch.turnstileEnabled = body.turnstileEnabled
  if (typeof body.turnstileSiteKey === 'string') patch.turnstileSiteKey = body.turnstileSiteKey.trim()
  if (typeof body.honeypotEnabled === 'boolean') patch.honeypotEnabled = body.honeypotEnabled
  if (typeof body.blockDisposableEmails === 'boolean') {
    patch.blockDisposableEmails = body.blockDisposableEmails
  }
  if (body.rateLimit !== undefined) patch.rateLimit = sanitizeRateLimit(body.rateLimit)

  // Display & triggers config
  if (body.display !== undefined) {
    const cleaned = sanitizeDisplay(body.display)
    patch.display = cleaned ?? { mode: 'inline' }
  }

  // Outbound webhook (US-091)
  if (body.webhookUrl !== undefined) patch.webhookUrl = sanitizeWebhookUrl(body.webhookUrl)
  if (body.webhookSecret !== undefined) {
    patch.webhookSecret = typeof body.webhookSecret === 'string' ? body.webhookSecret.trim() : ''
  }

  await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).update({
    ...patch,
    ...lastActorFrom(user),
  })

  const updated = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).get()
  return apiSuccess({ id, ...updated.data() })
})

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const existing = snap.data() as CaptureSource
  const scope = resolveOrgScope(user, existing.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).update({
    deleted: true,
    active: false,
    ...lastActorFrom(user),
  })

  return apiSuccess({ id, deleted: true })
})
